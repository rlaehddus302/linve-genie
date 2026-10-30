#!/bin/sh
# 가짜 프린터 만들기 (Command Line Tools의 swiftc만 쓴다 — Xcode·SwiftPM 없이도 된다).
# 결과: .build/sc/fake-printer, .build/sc/fake-printer-selftest
# SwiftPM이 되는 맥이면 `swift build -c release`도 같다 (.build/release/…).
set -eu
cd "$(dirname "$0")"
OUT=.build/sc
mkdir -p "$OUT"
swiftc -O -parse-as-library -module-name FakePrinterCore -emit-module -emit-module-path "$OUT/FakePrinterCore.swiftmodule" \
  -emit-library -static -o "$OUT/libFakePrinterCore.a" Sources/FakePrinterCore/*.swift
swiftc -O -I "$OUT" -L "$OUT" -lFakePrinterCore Sources/fake-printer/main.swift -o "$OUT/fake-printer" \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Sources/fake-printer/Info.plist
swiftc -O -I "$OUT" -L "$OUT" -lFakePrinterCore Sources/fake-printer-selftest/main.swift -o "$OUT/fake-printer-selftest"
echo "만들었다: $OUT/fake-printer, $OUT/fake-printer-selftest"
