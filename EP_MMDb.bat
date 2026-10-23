@echo off
if "%POSTGRES_URL%%DATABASE_URL%"=="" (
    echo POSTGRES_URL is not set. Set it to the PostgreSQL connection string first, e.g.
    echo     set POSTGRES_URL=postgresql://user:password@host:5432/dbname
    pause
    exit /b 1
)

echo Checking and installing required packages...
pip install -r "%~dp0requirements.txt"

echo.
echo Starting the server...
python "%~dp0app.py"

pause
