require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'AlpiplanCapacitorCallHints'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'UNLICENSED'
  s.homepage = 'https://github.com/martinhantha/avelom'
  s.author = 'Alpiplan'
  s.source = { :git => 'https://github.com/martinhantha/avelom.git', :tag => s.version.to_s }
  s.source_files = 'ios/Sources/CallHintsPlugin/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.9'
end
