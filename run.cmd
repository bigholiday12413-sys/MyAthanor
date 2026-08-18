@echo off
rem Start MyAthanor with the defaults documented in README.md
rem (PORT=3000 / HOST=0.0.0.0 / DB_PATH=data\myathanor.db).
rem ASCII only on purpose: cmd.exe misreads UTF-8 batch files.
cd /d "%~dp0"
npm start
