/**
 * trade_house · Plan de développement du back-end — 4 phases
 * (version courte ; le détail est dans docs/PLAN_BACKEND.md)
 *
 * Phase 1 — Socle & authentification .................. TERMINEE (59 assertions)
 * Phase 2 — Réunions & rappels ....................... EN COURS
 * Phase 3 — Rapports & cycle de correction ............ À VENIR
 * Phase 4 — Visio, tableau de bord & production ...... À VENIR
 *
 * Back uniquement : aucune interface n'est developpee avant la phase 4.
 * ---------------------------------------------------------------------------
 * POSTGRESQL
 *   psql -h localhost -U postgres -d trade_house          # SQL interactif
 *
 * NEXT.JS
 *   npm run dev                                          # http://localhost:3000
 *
 * MIGRATIONS
 *   db/setup.ps1                                         # recreer + installer
 *   db/test.ps1                                          # 67 assertions SQL
 *   db/migrations/001..013                              # SQL versionne
 *
 * QUALITE
 *   npm run db:validate                                  # syntaxe + semantique
 *   npm run verify:crypto                                # vecteurs RFC 6238
 *   npm run test:phase1                                  # 59 assertions API
 *   npm run typecheck
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
