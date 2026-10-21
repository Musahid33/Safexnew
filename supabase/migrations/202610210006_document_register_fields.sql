-- Vault register columns.
--
-- The app shows each shelf as the site's document register: department, section, document
-- number, revision and the date the document is valid up to. `documents` already carries the
-- code, revision and validity (`review_due_date`); department and section arrive here so the
-- register is complete without inventing either value on the client.

alter table public.documents
  add column if not exists department text;
alter table public.documents
  add column if not exists section text;

-- Same ceiling as the other short labels, so a stray paste cannot become the table.
alter table public.documents
  drop constraint if exists documents_department_length;
alter table public.documents
  add constraint documents_department_length
  check (department is null or length(department) <= 80);

alter table public.documents
  drop constraint if exists documents_section_length;
alter table public.documents
  add constraint documents_section_length
  check (section is null or length(section) <= 80);

-- The register is filtered by department/section inside one shelf, and ordered by validity.
create index if not exists documents_site_shelf_validity_idx
  on public.documents (company_id, location_id, category_id, review_due_date);
