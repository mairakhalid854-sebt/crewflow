/* global Deno, Response, TextDecoder, TextEncoder, URL, crypto, fetch, console, AbortSignal */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { unzipSync } from 'npm:fflate@0.8.2';

import {
  MAX_DOCUMENT_BYTES,
  PermanentKnowledgeError,
  boundedProcessingError,
  chunkPages,
  chunkPlainText,
  parseScannerResult,
} from '../_shared/knowledge-processing.ts';

const BATCH_SIZE = 2;
const DOCX_MEDIA_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function configuredSecretKeys() {
  const keys = [];
  const encodedKeys = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (encodedKeys) {
    try {
      const parsed = JSON.parse(encodedKeys);
      for (const value of Object.values(parsed)) {
        if (typeof value === 'string' && value.length > 0) keys.push(value);
      }
    } catch {
      return [];
    }
  }
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (legacyKey) keys.push(legacyKey);
  return [...new Set(keys)];
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isAuthorized(suppliedKey, secretKeys) {
  if (!suppliedKey || secretKeys.length === 0) return false;
  const suppliedHash = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(suppliedKey),
    ),
  );
  for (const secretKey of secretKeys) {
    const secretHash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(secretKey),
      ),
    );
    let difference = 0;
    for (let index = 0; index < suppliedHash.length; index += 1) {
      difference |= suppliedHash[index] ^ secretHash[index];
    }
    if (difference === 0) return true;
  }
  return false;
}

function decodeXml(value) {
  return value.replace(
    /&(?:lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g,
    (entity) => {
      const named = {
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
      };
      if (named[entity]) return named[entity];
      const hexadecimal = entity.startsWith('&#x');
      const digits = entity.slice(hexadecimal ? 3 : 2, -1);
      const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
      return Number.isSafeInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : '';
    },
  );
}

function extractDocxText(bytes) {
  let inflated;
  try {
    inflated = unzipSync(bytes, {
      filter: (entry) =>
        entry.name === 'word/document.xml' &&
        entry.originalSize <= 5 * 1024 * 1024,
    });
  } catch {
    throw new PermanentKnowledgeError('docx_invalid_archive');
  }
  const documentXml = inflated['word/document.xml'];
  if (!documentXml) throw new PermanentKnowledgeError('docx_missing_document');

  const xml = new TextDecoder('utf-8', { fatal: true }).decode(documentXml);
  const paragraphs = [];
  for (const paragraph of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
    const runs = [];
    for (const textNode of paragraph[1].matchAll(
      /<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g,
    )) {
      runs.push(decodeXml(textNode[1]));
    }
    if (runs.length > 0) paragraphs.push(runs.join(''));
  }
  return paragraphs.join('\n\n');
}

async function extractPdfPages(bytes) {
  let pdf;
  try {
    const { getDocument } =
      await import('npm:pdfjs-dist@5.4.394/legacy/build/pdf.mjs');
    pdf = await getDocument({
      data: bytes,
      disableWorker: true,
      isEvalSupported: false,
      useWorkerFetch: false,
    }).promise;
  } catch {
    throw new PermanentKnowledgeError('pdf_invalid_or_encrypted');
  }

  if (pdf.numPages < 1 || pdf.numPages > 1_000) {
    throw new PermanentKnowledgeError('invalid_page_count');
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => (typeof item?.str === 'string' ? item.str : ''))
        .join(' ');
      pages.push({ pageNumber, text });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

async function scanDocument(bytes, mediaType, sha256) {
  const scannerUrl = Deno.env.get('KNOWLEDGE_SCANNER_URL');
  const scannerToken = Deno.env.get('KNOWLEDGE_SCANNER_TOKEN');
  let parsedUrl;
  try {
    parsedUrl = new URL(scannerUrl ?? '');
  } catch {
    throw new Error('scanner_not_configured');
  }
  if (parsedUrl.protocol !== 'https:' || !scannerToken) {
    throw new Error('scanner_not_configured');
  }

  let response;
  try {
    response = await fetch(parsedUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${scannerToken}`,
        'content-type': mediaType,
        'x-content-sha256': sha256,
      },
      body: bytes,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error('scanner_network_error');
  }
  if (!response.ok) throw new Error(`scanner_http_${response.status}`);

  const body = await response.text();
  if (body.length > 10_000) throw new Error('scanner_invalid_response');
  try {
    return parseScannerResult(JSON.parse(body));
  } catch {
    throw new Error('scanner_invalid_response');
  }
}

async function downloadDocument(admin, job) {
  if (job.byte_size < 1 || job.byte_size > MAX_DOCUMENT_BYTES) {
    throw new PermanentKnowledgeError('document_size_invalid');
  }
  const { data, error } = await admin.storage
    .from('knowledge-documents')
    .download(job.storage_path);
  if (error || !data) throw new Error('storage_download_failed');
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (bytes.byteLength !== job.byte_size) {
    throw new PermanentKnowledgeError('stored_size_mismatch');
  }
  return bytes;
}

async function finishScan(admin, job, outcome) {
  const { error } = await admin.rpc('finish_knowledge_scan_job', {
    target_job_id: job.job_id,
    target_lease_token: job.lease_token,
    target_result: outcome.result,
    target_content_sha256: outcome.sha256,
    target_scanner_name: outcome.scannerName,
    target_scanner_version: outcome.scannerVersion,
    target_failure_code: outcome.failureCode ?? null,
  });
  if (error) throw new Error('scan_completion_failed');
}

async function processScan(admin, job, bytes, sha256) {
  if (sha256 !== job.upload_sha256_claim) {
    await finishScan(admin, job, {
      result: 'failed',
      sha256,
      scannerName: 'crewflow-integrity-check',
      scannerVersion: '1',
      failureCode: 'upload_hash_mismatch',
    });
    return;
  }

  const scanner = await scanDocument(bytes, job.media_type, sha256);
  await finishScan(admin, job, {
    result: scanner.verdict === 'clean' ? 'clean' : 'infected',
    sha256,
    scannerName: scanner.scannerName,
    scannerVersion: scanner.scannerVersion,
    ...(scanner.verdict === 'infected'
      ? { failureCode: 'malware_detected' }
      : {}),
  });
}

async function finishParse(admin, job, chunks, failureCode) {
  const { error } = await admin.rpc('finish_knowledge_parse_job', {
    target_job_id: job.job_id,
    target_lease_token: job.lease_token,
    target_chunks: chunks ?? null,
    target_failure_code: failureCode ?? null,
  });
  if (error) throw new Error('parse_completion_failed');
}

async function processParse(admin, job, bytes, sha256) {
  if (sha256 !== job.content_sha256) {
    await finishParse(admin, job, null, 'content_hash_changed');
    return;
  }

  let chunks;
  if (job.media_type === 'text/plain') {
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new PermanentKnowledgeError('text_not_utf8');
    }
    chunks = chunkPlainText(text, job.original_file_name);
  } else if (job.media_type === DOCX_MEDIA_TYPE) {
    chunks = chunkPlainText(extractDocxText(bytes), job.original_file_name);
  } else if (job.media_type === 'application/pdf') {
    chunks = chunkPages(await extractPdfPages(bytes), job.original_file_name);
  } else {
    throw new PermanentKnowledgeError('unsupported_media_type');
  }
  await finishParse(admin, job, chunks, null);
}

async function retry(admin, job, error) {
  const { error: retryError } = await admin.rpc(
    'retry_knowledge_processing_job',
    {
      target_job_id: job.job_id,
      target_lease_token: job.lease_token,
      target_error_code: boundedProcessingError(error),
    },
  );
  return !retryError;
}

async function processJob(admin, job) {
  try {
    const bytes = await downloadDocument(admin, job);
    const sha256 = await sha256Hex(bytes);
    if (job.stage === 'scan') await processScan(admin, job, bytes, sha256);
    else await processParse(admin, job, bytes, sha256);
    return 'completed';
  } catch (error) {
    if (error instanceof PermanentKnowledgeError) {
      const code = boundedProcessingError(error);
      try {
        if (job.stage === 'scan') {
          await finishScan(admin, job, {
            result: 'failed',
            sha256: '',
            scannerName: 'crewflow-integrity-check',
            scannerVersion: '1',
            failureCode: code,
          });
        } else {
          await finishParse(admin, job, null, code);
        }
        return 'failed';
      } catch {
        return (await retry(admin, job, error)) ? 'retried' : 'lease_error';
      }
    }
    return (await retry(admin, job, error)) ? 'retried' : 'lease_error';
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return json({ error: 'Method not allowed.' }, 405);
  const secretKeys = configuredSecretKeys();
  if (!(await isAuthorized(request.headers.get('apikey'), secretKeys))) {
    return json({ error: 'Unauthorized.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const adminKey = secretKeys[0];
  if (!supabaseUrl || !adminKey) {
    return json({ error: 'Knowledge processor is not configured.' }, 500);
  }
  const admin = createClient(supabaseUrl, adminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: jobs, error } = await admin.rpc(
    'claim_knowledge_processing_jobs',
    { target_batch_size: BATCH_SIZE },
  );
  if (error) {
    console.error('Unable to claim knowledge processing jobs.');
    return json({ error: 'Knowledge processing claim failed.' }, 500);
  }

  const counts = { completed: 0, failed: 0, retried: 0, lease_error: 0 };
  for (const job of jobs ?? []) {
    const outcome = await processJob(admin, job);
    counts[outcome] += 1;
  }
  return json({ claimed: jobs?.length ?? 0, ...counts });
});
