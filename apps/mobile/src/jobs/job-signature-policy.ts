export const CUSTOMER_SIGNATURE_CONSENT =
  'I confirm that the work described above was completed and authorize this electronic signature to be attached to this CrewFlow job.';

export const MAX_SIGNATURE_STROKES = 40;
export const MAX_SIGNATURE_POINTS_PER_STROKE = 500;

export type SignaturePoint = {
  readonly x: number;
  readonly y: number;
};

export type SignatureStroke = readonly SignaturePoint[];

export function signatureDraftError(
  signerName: string,
  strokes: readonly SignatureStroke[],
  consentAccepted: boolean,
): string | undefined {
  const normalizedName = signerName.trim();
  if (normalizedName.length < 2) return 'Enter the customer or signer name.';
  if (normalizedName.length > 120) {
    return 'Signer name cannot exceed 120 characters.';
  }
  if (!consentAccepted) return 'The customer must accept the consent text.';
  if (strokes.length === 0 || !strokes.some((stroke) => stroke.length >= 2)) {
    return 'Ask the customer to draw their signature.';
  }
  if (strokes.length > MAX_SIGNATURE_STROKES) {
    return 'Signature contains too many separate strokes. Clear and try again.';
  }
  if (
    strokes.some(
      (stroke) =>
        stroke.length < 2 || stroke.length > MAX_SIGNATURE_POINTS_PER_STROKE,
    )
  ) {
    return 'Signature stroke is incomplete or too detailed. Clear and try again.';
  }
  return undefined;
}

export function signaturePath(stroke: SignatureStroke): string {
  return stroke
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${point.x * 1000} ${point.y * 300}`,
    )
    .join(' ');
}
