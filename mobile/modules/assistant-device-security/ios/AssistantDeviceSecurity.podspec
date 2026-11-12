Pod::Spec.new do |s|
  s.name = 'AssistantDeviceSecurity'
  s.version = '0.1.0'
  s.summary = 'Contexify device proof of possession'
  s.description = 'Native nonexportable keys for the Contexify assistant security boundary.'
  s.license = { :type => 'MIT', :file => '../../../LICENSE' }
  s.author = 'Contexify'
  s.homepage = 'https://contexify.ai'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  # Autolinking installs this private module as a development pod via :path.
  # Source metadata must still use a supported podspec download strategy.
  s.source = { :git => "file://#{File.expand_path('../../../../', __dir__)}" }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
  s.frameworks = 'Security', 'LocalAuthentication', 'CryptoKit'
end
