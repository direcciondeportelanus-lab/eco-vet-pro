@echo off
echo ========================================
echo  ECO INFORMES - Dra. Raffo
echo ========================================
echo.
echo Iniciando servidor...

start "Backend" cmd /c "cd backend && uvicorn app.main:app --port 8000"
timeout /t 2 /nobreak > nul

start "Frontend" cmd /c "cd frontend && npm run dev"
timeout /t 3 /nobreak > nul

echo.
echo App lista en: http://localhost:3000
echo.
start http://localhost:3000
echo Deja estas ventanas abiertas mientras uses la app.
pause
