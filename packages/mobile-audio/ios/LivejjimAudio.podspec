require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'LivejjimAudio'
  s.version        = package['version']
  s.summary        = '라이브지니 앱 마이크 모듈 — 뒤에서도 16kHz 모노 PCM16 100ms 틀 (APP-02)'
  s.description    = package['description']
  s.author         = '라이브찜'
  s.homepage       = 'https://livejjim.example.invalid'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = '**/*.{h,m,mm,swift}'
end
