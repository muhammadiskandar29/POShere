# POShere Git Repository Workflow Rules

## Repository Scope
- Hanya lakukan git operasi (add, commit, push) di dalam direktori `c:\xampp\htdocs\POS` ke repository `https://github.com/muhammadiskandar29/POShere.git`.
- DILARANG KERAS menyentuh atau melakukan operasi git di project/folder lain di dalam `c:\xampp\htdocs\` (misalnya `inv-digital`, dll.).

## Auto-Push on Changes
- Setiap kali selesai membuat perubahan fitur, perbaikan bug, atau penambahan file di repository `c:\xampp\htdocs\POS`:
  1. Jalankan `git add .` di direktori `c:\xampp\htdocs\POS`.
  2. Buat commit deskriptif dengan `git commit -m "<deskripsi perubahan>"`.
  3. Push langsung ke branch `main` dengan `git push origin main`.
