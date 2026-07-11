@echo off
echo ========================================
echo  ECO INFORMES - SETUP INICIAL
echo ========================================
echo.

echo [1/3] Instalando backend Python...
cd backend
pip install -r requirements.txt
cd ..

echo.
echo [2/3] Instalando frontend React...
cd frontend
call npm install
cd ..

echo.
echo [3/3] Verificando plantilla...
if not exist plantilla.pdf (
    echo.
    echo  *** IMPORTANTE: Copia el archivo plantilla.pdf a esta carpeta ***
    echo.
)

echo.
echo ========================================
echo  SETUP COMPLETO
echo  Ejecuta start.bat para arrancar
echo ========================================
pause
