Pod::Spec.new do |s|
  s.name = 'AssistantVoice'
  s.version = '0.1.0'
  s.summary = 'Foreground on-device Contexify speech'
  s.description = 'Opt-in local English speech with foreground cancellation and text fallback.'
  s.license = { :type => 'MIT', :file => '../../../LICENSE' }
  s.author = 'Contexify'
  s.homepage = 'https://contexify.ai'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => "file://#{File.expand_path('../../../../', __dir__)}" }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'Speech', 'AVFoundation', 'UIKit'
end
