import { asUser, queryWith } from '@/lib/db';
import { pageUserAs } from '@/lib/page';
import { t } from '@/lib/i18n';
import Shell from '@/components/Shell';
import { PageHeader } from '@/components/ui';
import SettingsEditor from '@/components/SettingsEditor';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Reglages — Trade House' };

/**
 * Reglages (DESIGN_SYSTEM §6.10) — modifiables.
 *
 * L'ecran affichait les valeurs sans permettre de les changer, parce qu'aucune
 * fonction ne les ecrivait. C'est corrige : tout passe par
 * app.update_settings(), qui valide le type et les bornes puis journalise.
 *
 * Le catalogue des bornes est lu en base et transmis a l'interface. Les regles
 * ne sont donc pas dupliquees dans le TypeScript — une seule definition, la
 * seule qui fait autorite.
 */
export default async function SettingsPage() {
  const user = await pageUserAs(['admin']);

  const { settings, bounds } = await asUser(user.userId, async (sql) => ({
    settings: (await queryWith(sql, 'select * from app.settings()'))[0] ?? {},
    bounds: await queryWith<{ key: string; kind: string; lo: number; hi: number }>(
      sql,
      'select key, kind, lo, hi from app.settings_catalog() order by key',
    ),
  }));

  return (
    <Shell user={user}>
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          title={t(user.locale, 'nav.settings')}
          subtitle="Seuils, quotas et delais — modifies en base, jamais dans le code"
        />
        <SettingsEditor
          settings={settings as Record<string, string | number | null>}
          bounds={bounds.map((b) => ({
            key: String(b.key),
            kind: String(b.kind),
            lo: Number(b.lo),
            hi: Number(b.hi),
          }))}
        />
      </div>
    </Shell>
  );
}