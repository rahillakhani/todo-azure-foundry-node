CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS todos (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  description TEXT NOT NULL,
  due_date TIMESTAMPTZ,
  priority BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  embedding VECTOR(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS todos_user_id_idx ON todos (user_id);
CREATE INDEX IF NOT EXISTS todos_due_date_idx ON todos (due_date);
