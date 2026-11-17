Pod::Spec.new do |s|
  s.name           = 'LivejjimInk'
  s.version        = '0.0.0'
  s.summary        = '라이브지니 앱 손글씨 읽기'
  s.description    = '품종 칸에 손가락으로 쓴 글씨를 휴대폰 안 글자 읽기(Vision)로 읽는다. 인터넷·서버를 쓰지 않는다.'
  s.author         = 'livejjim'
  s.homepage       = 'https://github.com/unhoyeo/livegenie'
  s.license        = { :type => 'UNLICENSED' }
  s.platforms      = { :ios => '16.0' }
  s.source         = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files   = '*.swift'
  s.frameworks     = 'Vision', 'UIKit'
end
