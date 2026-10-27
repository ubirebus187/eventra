-- 1) Create an Auth account in Supabase Dashboard > Authentication > Users.
-- 2) Review profiles created by the trigger. The ID must match auth.users.id.
SELECT u.id, u.email, p.full_name, p.role
FROM auth.users u LEFT JOIN event.profiles p ON p.id = u.id
ORDER BY u.created_at DESC;

-- 3) Run the statement below SEPARATELY, only after replacing the email.
-- UPDATE event.profiles SET role = 'admin'
-- WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@contoh.com');
