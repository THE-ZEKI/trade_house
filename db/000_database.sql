-- La base est creee par db/setup.ps1 (CREATE DATABASE ne peut pas s'executer
-- dans un bloc transactionnel) - ce fichier sert de rappel de la commande :
--
--   psql -U postgres -d postgres -c "CREATE DATABASE trade_house OWNER postgres ENCODING 'UTF8'"
--
-- Puis : psql -U postgres -d trade_house -f db/install.sql

