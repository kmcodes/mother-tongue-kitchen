create table users (
  id uuid primary key default gen_random_uuid(),
  phone text unique not null,
  name text,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  title text,
  status text not null check (status in ('uploaded','transcribing','structuring','ready','failed')),
  note text,
  error text,
  language text,
  audio_pathname text not null,
  duration_sec integer not null,
  stt_job_id text unique,
  transcript_text text,
  ingredients jsonb,
  steps jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index recipes_owner_idx on recipes (owner_id, created_at desc);

create table segments (
  recipe_id uuid not null references recipes(id) on delete cascade,
  idx integer not null,
  text text not null,
  edited_text text,
  start_sec real not null,
  end_sec real not null,
  primary key (recipe_id, idx)
);
