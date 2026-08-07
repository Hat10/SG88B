-- Complete Boligflipping Migration Script
-- Drop existing tables if they exist
drop table if exists public.flipping_costs cascade;
drop table if exists public.flipping_projects cascade;

-- Create flipping_projects table
create table public.flipping_projects (
  id          uuid primary key default gen_random_uuid(),
  project_name text not null,
  purchase_price int not null,
  sale_price  int,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Create flipping_costs table
create table public.flipping_costs (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.flipping_projects(id) on delete cascade,
  category    text not null,
  description text not null,
  amount      int not null,
  date        date not null,
  created_at  timestamptz default now()
);

-- Enable Row Level Security
alter table public.flipping_projects enable row level security;
alter table public.flipping_costs enable row level security;

-- Create RLS policies for authenticated users
create policy "authenticated_projects_all" on public.flipping_projects
  for all using (auth.role() = 'authenticated');

create policy "authenticated_costs_all" on public.flipping_costs
  for all using (auth.role() = 'authenticated');

-- Grant permissions to authenticated users
grant select, insert, update, delete on public.flipping_projects to authenticated;
grant select, insert, update, delete on public.flipping_costs to authenticated;

-- Create indexes for fast queries
create index flipping_costs_project_id_idx on public.flipping_costs(project_id);
create index flipping_costs_date_idx on public.flipping_costs(date);
create index flipping_costs_category_idx on public.flipping_costs(category);
create index flipping_projects_created_at_idx on public.flipping_projects(created_at);

-- Done!
