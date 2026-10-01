@echo off
echo Checking and installing required packages...
pip install flask

echo.
echo Starting the server...
python app.py

pause
