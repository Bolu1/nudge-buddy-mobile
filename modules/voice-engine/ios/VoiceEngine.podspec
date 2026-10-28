Pod::Spec.new do |s|
  s.name           = 'VoiceEngine'
  s.version        = '1.0.0'
  s.summary        = 'Echo-cancelled voice IO with background support'
  s.description    = 'Echo-cancelled 16 kHz mic capture and PCM playback for Nudge Buddy calls'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
