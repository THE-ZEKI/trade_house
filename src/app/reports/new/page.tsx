import { redirect } from 'next/navigation';
import { pageUser } from '@/lib/page';
import { can } from '@/lib/permissions';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import ReportForm from './ReportForm';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Nouveau rapport — Trade House' };

/**
 * Depot d'un rapport (DESIGN_SYSTEM §7, priorite 1).
 *
 * Reserve au trader : un admin ou un manager qui ouvre cette URL est renvoye
 * vers l'accueil. `can()` ne decide rien, il evite juste d'afficher un
 * formulaire a quelqu'un dont toutes les valeurs seraient refusees en base.
 */
export default async function NewReportPage() {
  const user = await pageUser();
  if (!can(user, 'report.create')) redirect('/');

  return (
    <Shell user={user}>
      <div className="mx-auto max-w-[760px] space-y-5">
        <ReportForm user={user} locale={user.locale} label={(k) => t(user.locale, k)} />
      </div>
    </Shell>
  );
}
