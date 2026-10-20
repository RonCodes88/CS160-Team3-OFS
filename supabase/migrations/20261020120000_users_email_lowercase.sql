-- Login looks emails up by exact match after lowercasing them, so every stored
-- email must be lowercase. users_email_lower_key already guarantees no two
-- emails differ only by case, so lowercasing existing rows can't collide.

update public.users set email = lower(email) where email <> lower(email);

alter table public.users
  add constraint users_email_lowercase check (email = lower(email));
