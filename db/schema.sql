-- USERS (handled by Supabase Auth, but we keep reference table if needed)
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamp default now()
);

-- PROFILE
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  age int,
  sex text,
  height_cm int,
  weight_kg float,
  body_fat_percent float,
  activity_level text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- GOALS
create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  goal_type text, -- lose_weight, maintain, gain, performance, etc
  target_weight float,
  target_body_fat float,
  timeline_weeks int,
  daily_calorie_target int,
  daily_protein_target int,
  created_at timestamp default now()
);

-- MEAL LOGS (individual entries)
create table if not exists meal_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  food_name text,
  quantity float,
  calories int,
  protein float,
  carbs float,
  fat float,
  source text, -- ai, manual, label_scan, restaurant
  created_at timestamp default now()
);

-- DAILY SUMMARY (calculated totals)
create table if not exists daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  date date,
  total_calories int,
  total_protein float,
  total_carbs float,
  total_fat float,
  updated_at timestamp default now(),
  unique(user_id, date)
);

-- WEIGHT / PROGRESS TRACKING
create table if not exists progress_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  date date,
  weight_kg float,
  body_fat_percent float,
  notes text,
  created_at timestamp default now()
);

-- AI INTERACTIONS (for future learning / ML)
create table if not exists ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  role text, -- user or assistant
  message text,
  created_at timestamp default now()
);

-- RECOMMENDATIONS (track what user accepts)
create table if not exists recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade,
  type text, -- meal_plan, adjustment, suggestion
  content jsonb,
  accepted boolean default false,
  created_at timestamp default now()
);