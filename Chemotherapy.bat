@echo off
echo 필요한 패키지를 확인하고 설치합니다...
pip install flask flask-cors

echo.
echo 서버를 시작합니다...
python app.py

pause
