'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Send, Loader2, AlertCircle } from 'lucide-react';

export type Msg = {
  id: string;
  body: string;
  sender_id: string;
  recipient_id: string;
  read_at: string | null;
  created_at: string;
  sender_name: string | null;
  recipient_name: string | null;
};

/**
 * Un fil de discussion entre un manager et son trader.
 *
 * Aucun bouton « modifier » ni « supprimer » : le role applicatif n a
 * volontairement pas le droit d'UPDATE ni de DELETE sur public.messages, et la
 * base refuserait l operation. Les exposer ici prometrait une edition qui
 * echouerait apres coup.
 *
 * L alignement des bulles depend de qui parle, pas d'une comparaison d'identite
 * faite par un lib externe : c'est une regle de lecture, pas de securite.
 */
export default function MessageThread({
  messages,
  meId,
  counterpartId,
  counterpartName,
  disabled,
}: {
  messages: Msg[];
  meId: string;
  counterpartId: string;
  counterpartName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEn = typeof navigator !== 'undefined' && navigator.language?.startsWith('en');
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString(isEn ? 'en-GB' : 'fr-FR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

  async function send() {
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipientId: counterpartId, body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.error) {
        setError(data?.error?.message ?? 'Envoi refuse');
        return;
      }
      setText('');
      router.refresh();
    } catch {
      setError('Serveur injoignable');
    } finally {
      setBusy(false);
    }
  }

  const input =
    'flex-1 rounded-[10px] border border-border-strong bg-white px-3 py-2 text-sm outline-none focus:border-sky-500';

  return (
    <div className="grid gap-3">
      <div className="grid max-h-[420px] gap-2 overflow-y-auto rounded-[10px] border border-border bg-surface-alt p-3">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-faint">
            Aucun message. {isEn ? 'Write the first one.' : 'Ecris le premier.'}
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.sender_id === meId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[85%] rounded-[12px] px-3 py-2 text-sm ${
                    mine ? 'bg-sky-500 text-white' : 'bg-white text-text'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p
                    className={`mt-1 text-[11px] ${mine ? 'text-white/70' : 'text-text-faint'}`}
                  >
                    {fmt(m.created_at)}
                    {!mine && m.read_at ? ' · ' + (isEn ? 'read' : 'lu') : ''}
                  </p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="flex items-center gap-2 text-xs text-danger-fg">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
          {error}
        </p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée passe à la ligne : c'est ce que le
            // commerce du clavier rend naturel dans une zone de saisie.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          disabled={disabled}
          placeholder={`${isEn ? 'Message to' : 'Message a'} ${counterpartName}`}
          className={`${input} resize-y`}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || disabled || !text.trim()}
          aria-label="Envoyer"
          className="inline-flex h-10 shrink-0 items-center gap-2 rounded-[10px] bg-sky-500 px-4 text-sm font-semibold text-white hover:bg-sky-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" strokeWidth={2.2} />}
        </button>
      </div>
      {text.length > 3500 && (
        <p className="text-right text-xs text-text-faint tnum">{text.length} / 4000</p>
      )}
    </div>
  );
}