Pod::Spec.new do |s|
  s.name           = 'LivejjimNotice'
  s.version        = '0.0.0'
  s.summary        = '라이브지니 문자찜·입금 알림 받기 (단축어 동작)'
  s.description    = '아이폰 단축어 자동화가 넘긴 문자를 거르고 암호화 대기열에 넣어 서버로 보낸다.'
  s.author         = 'livejjim'
  s.homepage       = 'https://github.com/unhoyeo/livegenie'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.swift'
  # Package.swift는 macOS `swift test`용 — 앱 빌드에 넣으면 PackageDescription을 못 찾아 실패한다
  s.exclude_files  = 'Package.swift'
  s.frameworks     = 'AppIntents', 'Security', 'CryptoKit'
end
