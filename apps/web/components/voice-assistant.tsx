'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import {
  resolveVoiceCommand,
  voiceVisualState,
  type VoiceRole,
} from '../lib/voice/voice-commands';

type AlanButton = {
  setVisualState: (state: object) => void;
  remove: () => void;
};

// Alan AI voice assistant. Off unless NEXT_PUBLIC_ALAN_SDK_KEY is set at build
// time. The 9 MB Alan library is loaded only then, as a separate chunk.
const alanKey = process.env.NEXT_PUBLIC_ALAN_SDK_KEY?.trim();
const alanHost = process.env.NEXT_PUBLIC_ALAN_HOST?.trim() || 'v1.alan.app';

export function VoiceAssistant({ role }: { readonly role: VoiceRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const buttonRef = useRef<AlanButton | null>(null);
  const routerRef = useRef(router);
  const roleRef = useRef(role);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    routerRef.current = router;
    roleRef.current = role;
    pathnameRef.current = pathname;
  }, [router, role, pathname]);

  useEffect(() => {
    if (!alanKey) return;
    let cancelled = false;

    void import('@alan-ai/alan-sdk-web')
      .then(({ default: alanBtn }) => {
        if (cancelled || buttonRef.current) return;
        const button = alanBtn({
          key: alanKey,
          host: alanHost,
          bottom: 24,
          right: 24,
          zIndex: 40,
          onCommand: (data: object) => {
            const action = resolveVoiceCommand(data, roleRef.current);
            if (!action) return;
            if (action.kind === 'back') routerRef.current.back();
            else routerRef.current.push(action.href);
          },
        });
        buttonRef.current = button;
        button.setVisualState(
          voiceVisualState(pathnameRef.current, roleRef.current),
        );
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      buttonRef.current?.remove();
      buttonRef.current = null;
    };
  }, []);

  useEffect(() => {
    buttonRef.current?.setVisualState(voiceVisualState(pathname, role));
  }, [pathname, role]);

  return null;
}
