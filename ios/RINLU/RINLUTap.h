#import <AVFoundation/AVFoundation.h>
NS_ASSUME_NONNULL_BEGIN
@interface RINLUTap : NSObject
@property(nonatomic) BOOL enabled;
@property(nonatomic,readonly) BOOL formatUnsupported;
@property(nonatomic,readonly) BOOL hasProcessedAudio;
- (instancetype)initWithSettings:(NSDictionary *)settings strength:(double)strength;
- (nullable AVAudioMix *)mixForTrack:(AVAssetTrack *)track NS_SWIFT_NAME(mix(for:));
@end
NS_ASSUME_NONNULL_END
