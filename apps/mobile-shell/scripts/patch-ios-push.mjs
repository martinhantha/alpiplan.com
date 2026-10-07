import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const iosApp = resolve(root, "ios/App");
const podfilePath = resolve(iosApp, "Podfile");
const pbxprojPath = resolve(iosApp, "App.xcodeproj/project.pbxproj");
const appDelegatePath = resolve(iosApp, "App/AppDelegate.swift");
const infoPlistPath = resolve(iosApp, "App/Info.plist");
const entitlementsPath = resolve(iosApp, "App/App.entitlements");
const firebasePlistTarget = resolve(iosApp, "App/GoogleService-Info.plist");

if (!existsSync(podfilePath) || !existsSync(pbxprojPath)) process.exit(0);

// Xcode 26+ only accepts iOS 15.0 or newer; Capacitor 7 templates and podspecs still say 14.0.
const DEPLOYMENT_TARGET = "15.0";

const firebasePlistSource =
  [
    resolve(root, "GoogleService-Info.plist"),
    resolve(root, "../../GoogleService-Info.plist"),
  ].find((file) => existsSync(file)) ?? null;
if (firebasePlistSource) copyFileSync(firebasePlistSource, firebasePlistTarget);
const withFirebase = existsSync(firebasePlistTarget);

function writeIfChanged(file, next) {
  if (existsSync(file) && readFileSync(file, "utf8") === next) return false;
  writeFileSync(file, next);
  return true;
}

// --- Podfile ---------------------------------------------------------------

let podfile = readFileSync(podfilePath, "utf8");
podfile = podfile.replace(/platform :ios, '[^']+'/, `platform :ios, '${DEPLOYMENT_TARGET}'`);

if (!podfile.includes("ALPIPLAN_DEPLOYMENT_TARGET")) {
  podfile = podfile.replace(
    /(post_install do \|installer\|\n\s*assertDeploymentTarget\(installer\)\n)/,
    `$1  # ALPIPLAN_DEPLOYMENT_TARGET: raise pods that still declare iOS 14.
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      if config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${DEPLOYMENT_TARGET}
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${DEPLOYMENT_TARGET}'
      end
    end
  end
`,
  );
}

const firebasePod = "  pod 'FirebaseMessaging'\n";
if (withFirebase && !podfile.includes(firebasePod)) {
  podfile = podfile.replace(/(target 'App' do\n\s*capacitor_pods\n)/, `$1${firebasePod}`);
} else if (!withFirebase) {
  podfile = podfile.replace(firebasePod, "");
}
const podfileChanged = writeIfChanged(podfilePath, podfile);

// --- Entitlements ------------------------------------------------------------

// Only with Firebase: free "Personal Team" signing rejects the push entitlement.
// Xcode switches aps-environment to production when signing for TestFlight / App Store.
if (withFirebase) {
  writeIfChanged(
    entitlementsPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>aps-environment</key>
	<string>development</string>
</dict>
</plist>
`,
  );
}

// --- Xcode project -----------------------------------------------------------

const FIREBASE_FILE_REF = "A1B2C3D4E5F6A7B8C9D0E101";
const FIREBASE_BUILD_FILE = "A1B2C3D4E5F6A7B8C9D0E102";

let pbxproj = readFileSync(pbxprojPath, "utf8").replace(
  /IPHONEOS_DEPLOYMENT_TARGET = [^;]+;/g,
  `IPHONEOS_DEPLOYMENT_TARGET = ${DEPLOYMENT_TARGET};`,
);

if (withFirebase && !pbxproj.includes("CODE_SIGN_ENTITLEMENTS")) {
  pbxproj = pbxproj.replace(
    /(\n(\t+)INFOPLIST_FILE = App\/Info\.plist;)/g,
    "\n$2CODE_SIGN_ENTITLEMENTS = App/App.entitlements;$1",
  );
} else if (!withFirebase) {
  pbxproj = pbxproj.replace(/\n\t+CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g, "");
}

if (withFirebase && !pbxproj.includes(FIREBASE_FILE_REF)) {
  pbxproj = pbxproj
    .replace(
      "/* End PBXBuildFile section */",
      `\t\t${FIREBASE_BUILD_FILE} /* GoogleService-Info.plist in Resources */ = {isa = PBXBuildFile; fileRef = ${FIREBASE_FILE_REF} /* GoogleService-Info.plist */; };\n/* End PBXBuildFile section */`,
    )
    .replace(
      "/* End PBXFileReference section */",
      `\t\t${FIREBASE_FILE_REF} /* GoogleService-Info.plist */ = {isa = PBXFileReference; lastKnownFileType = text.plist.xml; path = "GoogleService-Info.plist"; sourceTree = "<group>"; };\n/* End PBXFileReference section */`,
    )
    .replace(
      /(\/\* Info\.plist \*\/,\n)(\t+)/,
      `$1$2${FIREBASE_FILE_REF} /* GoogleService-Info.plist */,\n$2`,
    )
    .replace(
      /(isa = PBXResourcesBuildPhase;\n\t+buildActionMask = \d+;\n\t+files = \(\n)(\t+)/,
      `$1$2${FIREBASE_BUILD_FILE} /* GoogleService-Info.plist in Resources */,\n$2`,
    );
} else if (!withFirebase) {
  pbxproj = pbxproj
    .split("\n")
    .filter((line) => !line.includes(FIREBASE_FILE_REF) && !line.includes(FIREBASE_BUILD_FILE))
    .join("\n");
}
writeIfChanged(pbxprojPath, pbxproj);

// --- Info.plist --------------------------------------------------------------

if (existsSync(infoPlistPath)) {
  let info = readFileSync(infoPlistPath, "utf8");
  if (!info.includes("<key>FirebaseAppDelegateProxyEnabled</key>")) {
    // AppDelegate forwards the APNs token itself; swizzling would fight our notification delegate.
    info = info.replace(
      /\s*<\/dict>\s*<\/plist>\s*$/,
      "\n\t<key>FirebaseAppDelegateProxyEnabled</key>\n\t<false/>\n</dict>\n</plist>\n",
    );
    writeIfChanged(infoPlistPath, info);
  }
}

// --- AppDelegate -------------------------------------------------------------

writeIfChanged(
  appDelegatePath,
  `import UIKit
import UserNotifications
import Capacitor
#if canImport(FirebaseMessaging)
import FirebaseCore
import FirebaseMessaging
#endif

// Generated by apps/mobile-shell/scripts/patch-ios-push.mjs — edit the script, not this file.
@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        #if canImport(FirebaseMessaging)
        if Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil {
            FirebaseApp.configure()
            Messaging.messaging().delegate = self
        }
        #endif
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
        #if canImport(FirebaseMessaging)
        guard FirebaseApp.app() != nil else { return }
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, _ in
            if let token { Self.publishPushToken(token) }
        }
        #endif
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    static func publishPushToken(_ token: String) {
        UserDefaults.standard.set(token, forKey: "alpiplan.pushToken")
        NotificationCenter.default.post(name: Notification.Name("AlpiplanPushToken"), object: nil, userInfo: ["token": token])
    }

    // While the app is open the web layer shows its own alert and local notification,
    // so only local notifications get a banner; remote pushes would duplicate them.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        if notification.request.trigger is UNPushNotificationTrigger {
            completionHandler([])
        } else {
            completionHandler([.banner, .list, .sound])
        }
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}

#if canImport(FirebaseMessaging)
extension AppDelegate: MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        if let fcmToken { Self.publishPushToken(fcmToken) }
    }
}
#endif
`,
);

// --- Pods --------------------------------------------------------------------

if (podfileChanged && process.platform === "darwin") {
  const result = spawnSync("pod", ["install"], { cwd: iosApp, stdio: "inherit" });
  if (result.status !== 0) {
    console.warn("pod install failed — run it manually in apps/mobile-shell/ios/App.");
  }
}

console.log(
  withFirebase
    ? "Patched iOS push (APNs entitlement + Firebase Cloud Messaging)."
    : "Patched iOS push entitlement. No GoogleService-Info.plist found — FCM disabled on iOS.",
);
