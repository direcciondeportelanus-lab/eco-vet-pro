@echo off
echo ========================================
echo  ECO VET PRO - Dra. Raffo
echo ========================================

set /p SUPABASE_URL=Supabase URL (o ENTER para skip): 
set /p SUPABASE_KEY=Supabase Key (o ENTER para skip): 

echo.
echo Iniciando backend...
start "Backend" cmd /k "cd backend && set SUPABASE_URL=%SUPABASE_URL% && set SUPABASE_KEY=%SUPABASE_KEY% && uvicorn app.main:app --port 8001"
timeout /t 3 /nobreak > nul

echo Iniciando frontend...
start "Frontend" cmd /k "cd frontend && npx vite --port 3001"
timeout /t 3 /nobreak > nul

echo.
echo App lista en: http://localhost:3001
start http://localhost:3001
pause
