TASK: CLEAN SCREEN TRACKING
Objective:

Replace default Firebase screen tracking with manual product-level screen tracking.

Steps:
Create helper:
logScreenView(screen_name)
Implement on all main screens:
home
onboarding steps
paywall
camera
editor
referral
settings
Use consistent naming:
lowercase
snake_case
DO NOT rely on:
RNSScreen
UIViewController
RCTFabricModalHostViewController