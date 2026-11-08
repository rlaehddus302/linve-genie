Pod::Spec.new do |s|
  s.name           = 'LivejjimWebSession'
  s.version        = '0.0.0'
  s.summary        = '라이브지니 앱 안 웹 화면 로그인 세션 지키기'
  s.description    = '우체국처럼 세션 쿠키로 로그인을 지키는 사이트의 세션 쿠키를 기기 키체인에만 두었다가 앱을 다시 켤 때 WKWebView 쿠키 저장소에 되살린다.'
  s.author         = 'livejjim'
  s.homepage       = 'https://github.com/unhoyeo/livegenie'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.swift'
  s.frameworks     = 'WebKit', 'Security'
end
