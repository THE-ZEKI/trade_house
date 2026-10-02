import { callApp, asUser} from '@/lib/db';
import { jsonError, jsonOk } from '@/lib/http';
import { appUrl, mayExposeToken, sendEmail } from '@/lib/email';
import { requireUser } from '@/lib/auth';
import { AppError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

type Body = {
  email: string;
  fullName: string;
  role: 'admin' | 'manager' | 'trader';
  managerId?: string | null;
  phone?: string | null;
  timezone?: string;
} | null;

function parse(raw: unknown): Body {
  if (typeof raw !== 'object' || raw === null) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.email !== 'string' || typeof b.fullName !== 'string') return null;
  if (b.role !== 'admin' && b.role !== 'manager' && b.role !== 'trader') return null;
  return {
    email: b.email.trim(),
    fullName: b.fullName.trim(),
    role: b.role,
    managerId: typeof b.managerId === 'string' ? b.managerId : null,
    phone: typeof b.phone === 'string' ? b.phone : null,
    timezone: typeof b.timezone === 'string' ? b.timezone : 'UTC',
  };
}

/**
 * POST /api/auth/invitation — A2 / RG-05
 *
 * Reserve a l'admin (verifie en base par app.create_user). Cree le compte puis
 * emet une invitation valable 7 jours (RG-05). Un renvoi revoque le lien
 * precedent : la base le fait (BEFORE INSERT sur user_invitations).
 */
export async function POST(request: Request) {
  const body = parse(await request.json().catch(() => null));
  if (!body) {
    return jsonOk({ error: { code: 'VALIDATION', message: 'Donnees invalides', rule: null } }, 422);
  }

  try {
    const admin = await requireUser();
    if (admin.role !== 'admin') {
      throw new AppError('FORBIDDEN', 'Seul un administrateur peut inviter', { status: 403, rule: 'RG-02' });
    }

    const created = await asUser(admin.userId, (sql) =>
      callApp<{ id: string; email: string; full_name: string; role: string }>(
        sql,
        'app.create_user',
        [body.email, body.fullName, body.role, body.managerId ?? null, body.phone ?? null, body.timezone ?? 'UTC'],
      ),
    );
    if (!created) throw new AppError('INTERNAL', 'Creation du compte impossible');

    const token = await asUser(admin.userId, (sql) =>
      callApp<string>(sql, 'app.issue_invitation', [created.id, 'invite']),
    );

    const link = `${appUrl()}/invitation?token=${token}`;
    await sendEmail({
      to: created.email,
      subject: 'Votre acces a Trade House',
      text: `Bonjour ${created.full_name},\n\n definit votre mot de passe : ${link}\n\nCe lien expire dans 7 jours.`,
    });

    return jsonOk(
      {
        status: 'invited',
        user: { id: created.id, email: created.email, role: created.role },
        // le jeton ne sort de l'API qu'en developpement
        ...(mayExposeToken() ? { devToken: token, devLink: link } : {}),
      },
      201,
    );
  } catch (error) {
    return jsonError(error);
  }
}
