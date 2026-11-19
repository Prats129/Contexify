Pod::Spec.new do |s|
  s.name = 'AssistantPlatform'
  s.version = '0.1.0'
  s.summary = 'Contexify foreground Apple handoffs'
  s.description = 'User-reviewed Calendar editor and an authenticated Assistant screen shortcut.'
  s.license = { :type => 'MIT', :file => '../../../LICENSE' }
  s.author = 'Contexify'
  s.homepage = 'https://contexify.ai'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => "file://#{File.expand_path('../../../../', __dir__)}" }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.resource_bundles = { 'AssistantPlatformPrivacy' => ['PrivacyInfo.xcprivacy'] }
  s.frameworks = 'AppIntents', 'EventKit', 'EventKitUI', 'UIKit'
end
