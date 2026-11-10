-- Task 4.9: an alert judged unreliable is withdrawn, not deleted. Additive only.
ALTER TYPE "AlertStatus" ADD VALUE IF NOT EXISTS 'withdrawn';
