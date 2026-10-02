/**
 * trade_house · Plateforme de gestion et de suivi de traders
 * (Next.js 15 + PostgreSQL 18 ; le detail est dans README.md et docs/)
 *
 * PRINCIPE : la logique metier vit EN BASE (fonctions app.* en SECURITY DEFINER,
 * triggers, CHECK, RLS). Les routes Next ne valident l'entree et ne traduisent la
 * reponse. Ne jamais dupliquer une regle RG-xx dans le TypeScript.
 * ---------------------------------------------------------------------------
 * ETAT
 *   Back-end : terminé (phases 1 a 4 de docs/PLAN_BACKEND.md)
 *   Interface : terminée (pages App Router dans src/app)
 *   Modules : comptes, reunions, rapports + corrections, annotations, formation,
 *             visio (independante du fournisseur), export PDF/CSV, audit
 *   Restant a faire : deploiement (fournisseur de visio, stockage s3/supabase,
 *             webhook de bounces SMTP), deleting des comptes de developpement
 * ---------------------------------------------------------------------------
 * POSTGRESQL
 *   psql -h localhost -U postgres -d trade_house          # SQL interactif
 *
 * NEXT.JS
 *   npm run dev                                          # http://localhost:3000
 *   npm run build && npm start                           # production
 *
 * MIGRATIONS
 *   db/setup.ps1                                         # recreer + installer
 *   db/test.ps1                                          # assertions SQL
 *   db/migrate.ps1                                       # appliquer les nouvelles
 *   db/migrations/001..025                              # SQL versionne
 *   db/install.sql                                       # genere (tools/generate-install-sql.ps1)
 *
 * QUALITE
 *   npm run check:all        # typecheck + calls + actions + perms + pages
 *   npm run db:validate      # syntaxe + semantique
 *   npm run verify:crypto    # vecteurs RFC 6238
 *   npm run verify:email     # adaptateur de courriel configure
 *   npm run verify:reports   # stockage des fichiers
 *   npm run verify:export    # generation PDF
 *   npm run verify:room      # jetons de salle
 *   npm run test:phase1      # 59 assertions API
 *   npm run typecheck
 *
 * REGLES D'ECRITURE
 *   - les .sql restent en ASCII (db/tools/ascii-ify.ps1 -Check) : PowerShell 5.1
 *     lit de l'UTF-8 sans BOM comme de l'Ansi, et psql affiche des messages illisibles ;
 *   - toute fonction app.* appelee depuis une route doit etre ajoutee a la liste
 *     blanche de scripts/check-app-calls.ps1, sinon check:calls echoue ;
 *   - un droit affiche dans l'interface doit exister dans permissions.ts ET etre
 *     verifie en base (scripts/check-permissions.ps1 compare le HTML rendu).
 *
 * JOB RAPPELS
 *   POST|GET http://localhost:3000/api/cron/send-reminders
 *   Authorization: Bearer <CRON_SECRET>
 *   -> declenchement toutes les minutes (garantie +/- 1 min du cahier des charges)
 *
 * ACCES AUX COMPTES DE DEVELOPPEMENT
 *   admin@trade-house.local   / Admin!2345     (2FA activable)
 *   manager@trade-house.local / Manager!2345
 *   trader1@trade-house.local / Trader!2345
 *   trader2@trade-house.local / Trader!2345
 *   -> a supprimer avant la mise en ligne (db/migrations/009_seed.sql)
 * ---------------------------------------------------------------------------
