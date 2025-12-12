#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(ImageCompositor, NSObject)

RCT_EXTERN_METHOD(compositeImages:(NSString *)beforeUri
                  afterUri:(NSString *)afterUri
                  layout:(NSString *)layout
                  width:(nonnull NSNumber *)width
                  height:(nonnull NSNumber *)height
                  topHeight:(NSNumber *)topHeight
                  bottomHeight:(NSNumber *)bottomHeight
                  leftWidth:(NSNumber *)leftWidth
                  rightWidth:(NSNumber *)rightWidth
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(addLabelToImage:(NSString *)imageUri
                  labelText:(NSString *)labelText
                  labelConfig:(NSDictionary *)labelConfig
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
