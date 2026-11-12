Pod::Spec.new do |s|
  s.name = 'LiveGeniePrintStation'
  s.version = '0.0.0'
  s.summary = 'Finish in-flight Bluetooth label printing when leaving the app.'
  s.author = 'livegenie'
  s.homepage = 'https://github.com/Port-051/livegenie'
  s.license = { :type => 'UNLICENSED' }
  s.platform = :ios, '16.0'
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '*.swift'
end
