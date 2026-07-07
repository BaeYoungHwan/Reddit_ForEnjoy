#!/usr/bin/env python3
"""
send_notification.py -- 하네스 이메일 알림 발송 유틸리티

사용법:
  python send_notification.py "제목"                         # close-project 호환
  python send_notification.py --mode plan-report
      --subject "..." --body "..."                           # Plan 모드 완료 리포트
  python send_notification.py --mode failure-alert
      --subject "..." --body "..."                           # ultrawork 실패 알림

환경변수 (.env에서 자동 로드):
  SMTP_HOST, SMTP_PORT (기본 587), SMTP_FROM, SMTP_TO, SMTP_PASSWORD
  SMTP_USE_SSL (true/false, 기본 false — 포트 465 SSL 전용 서버용)

Graceful skip 조건 (exit 0):
  - .env 파일 없음
  - SMTP_HOST 미설정
  - SMTP_PASSWORD 플레이스홀더(your-smtp-password)
"""
import smtplib
import sys
import os
import argparse
from email.mime.text import MIMEText
from datetime import datetime


def load_dotenv(path=".env"):
    env = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    return env


def graceful_skip(msg):
    print("이메일 건너뜀 -- " + msg, file=sys.stderr)
    sys.exit(0)


def check_config(env):
    if not env:
        graceful_skip(".env 파일 없음")
    if not env.get("SMTP_HOST"):
        graceful_skip("SMTP_HOST 미설정")
    if env.get("SMTP_PASSWORD", "") in ("your-smtp-password", ""):
        graceful_skip("SMTP_PASSWORD 미설정 (플레이스홀더 상태)")


def send_email(env, subject, body):
    host = env["SMTP_HOST"]
    port = int(env.get("SMTP_PORT", 587))
    use_ssl = env.get("SMTP_USE_SSL", "").lower() in ("true", "1", "yes")
    from_addr = env.get("SMTP_FROM", "")
    if not from_addr:
        print("경고: SMTP_FROM 미설정 -- SMTP_TO를 발신자로 사용합니다", file=sys.stderr)
        from_addr = env.get("SMTP_TO", "")
    to_addr = env.get("SMTP_TO", "")
    password = env.get("SMTP_PASSWORD", "")

    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr

    try:
        if use_ssl:
            ctx = smtplib.SMTP_SSL(host, port, timeout=10)
        else:
            ctx = smtplib.SMTP(host, port, timeout=10)
            ctx.ehlo()
            ctx.starttls()
        with ctx as server:
            server.login(from_addr, password)
            server.sendmail(from_addr, [to_addr], msg.as_string())
        print("이메일 발송 완료 -> " + to_addr)
    except Exception as e:
        print("이메일 발송 실패: " + str(e), file=sys.stderr)
        sys.exit(1)


def build_body(args):
    if args.body:
        return args.body
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    nl = chr(10)
    lines = [
        "완료 시각: " + now,
        "태스크: " + str(args.task_done) + "/" + str(args.task_total) + " 완료",
        "Lint: " + str(args.lint_result),
        "테스트: " + str(args.test_result),
        "Verdict: " + str(args.verdict),
    ]
    return nl.join(lines)


def main():
    parser = argparse.ArgumentParser(description="하네스 이메일 알림 발송")
    parser.add_argument("title", nargs="?", help="제목 (close-project 호환 위치 인수)")
    parser.add_argument("--mode", choices=["plan-report", "failure-alert"], default="failure-alert")
    parser.add_argument("--subject", default="")
    parser.add_argument("--body", default="")
    parser.add_argument("--task-done", dest="task_done", default="?")
    parser.add_argument("--task-total", dest="task_total", default="?")
    parser.add_argument("--lint-result", dest="lint_result", default="확인 필요")
    parser.add_argument("--test-result", dest="test_result", default="확인 필요")
    parser.add_argument("--verdict", default="확인 필요")

    args = parser.parse_args()

    env = load_dotenv()
    check_config(env)

    if args.title and not args.subject:
        subject = args.title
        body = args.body or args.title
    else:
        subject = args.subject or "[하네스 알림] " + args.mode
        body = build_body(args)

    send_email(env, subject, body)


if __name__ == "__main__":
    main()
