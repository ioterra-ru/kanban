-- Add read-only board role (view assigned boards only; no card/column edits).
ALTER TYPE "Role" ADD VALUE 'OBSERVER';
