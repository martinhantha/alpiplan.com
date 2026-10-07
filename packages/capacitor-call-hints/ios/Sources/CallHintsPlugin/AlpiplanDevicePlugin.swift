import AVFoundation
import Capacitor
import Contacts
import UIKit
import UserNotifications

extension Notification.Name {
    /// Posted by the app's AppDelegate with `userInfo["token"]` once Firebase Messaging has an FCM token.
    public static let alpiplanPushToken = Notification.Name("AlpiplanPushToken")
}

@objc(AlpiplanDevicePlugin)
public class AlpiplanDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    /// Shared with the AppDelegate, which caches the latest FCM token under this key.
    public static let pushTokenDefaultsKey = "alpiplan.pushToken"
    private static let pushTokenTimeout: TimeInterval = 15

    public let identifier = "AlpiplanDevicePlugin"
    public let jsName = "AlpiplanDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAllPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestMicrophone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openAppSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openWhatsApp", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveLocalContact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "findContactByPhone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteContactByPhone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "showLocalNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPushToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startSpeechRecognition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopSpeechRecognition", returnType: CAPPluginReturnPromise)
    ]

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        resolvePermissionStatus(call)
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        let alias = call.getString("alias")
        if alias == "contacts" {
            CNContactStore().requestAccess(for: .contacts) { _, _ in
                self.resolvePermissionStatus(call)
            }
            return
        }
        if alias == "microphone" {
            requestMicrophone(call)
            return
        }
        if alias == "notifications" {
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
                if granted {
                    DispatchQueue.main.async {
                        UIApplication.shared.registerForRemoteNotifications()
                    }
                }
                self.resolvePermissionStatus(call)
            }
            return
        }
        requestAllPermissions(call)
    }

    @objc func requestAllPermissions(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { _ in
            CNContactStore().requestAccess(for: .contacts) { _, _ in
                self.resolvePermissionStatus(call)
            }
        }
    }

    @objc func requestMicrophone(_ call: CAPPluginCall) {
        AVAudioSession.sharedInstance().requestRecordPermission { _ in
            self.resolvePermissionStatus(call)
        }
    }

    @objc func openAppSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) {
                UIApplication.shared.open(url)
            }
            call.resolve()
        }
    }

    @objc func openWhatsApp(_ call: CAPPluginCall) {
        let phone = call.getString("phone") ?? ""
        let app = call.getString("app") ?? "whatsapp"
        let digits = Self.normalizeWhatsAppDigits(phone)
        if digits.isEmpty {
            call.reject("Keine Telefonnummer")
            return
        }
        let scheme = app == "business"
            ? "whatsapp-business://send?phone=\(digits)"
            : "whatsapp://send?phone=\(digits)"
        DispatchQueue.main.async {
            guard let url = URL(string: scheme) else {
                call.reject("Ungültige WhatsApp-Adresse")
                return
            }
            UIApplication.shared.open(url, options: [:]) { success in
                if success {
                    call.resolve()
                } else {
                    let label = app == "business" ? "WhatsApp Business" : "WhatsApp"
                    call.reject("\(label) ist nicht installiert")
                }
            }
        }
    }

    private static func normalizeWhatsAppDigits(_ phone: String) -> String {
        var digits = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        if digits.hasPrefix("00") {
            digits = String(digits.dropFirst(2))
        } else if digits.hasPrefix("+") {
            digits = String(digits.dropFirst())
        }
        digits = digits.filter { $0.isNumber }
        if digits.hasPrefix("0"), digits.count > 1 {
            digits = "43" + digits.dropFirst()
        }
        return digits
    }

    @objc func saveLocalContact(_ call: CAPPluginCall) {
        let store = CNContactStore()
        store.requestAccess(for: .contacts) { granted, error in
            if !granted {
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "Contacts permission denied")
                }
                return
            }
            let result: [String: String]
            do {
                let contact = CNMutableContact()
                let displayName = call.getString("displayName")?.trimmingCharacters(in: .whitespacesAndNewlines)
                contact.givenName = (displayName?.isEmpty == false) ? displayName! : "Alpiplan Kontakt"
                contact.organizationName = call.getString("organization") ?? "Alpiplan"
                contact.jobTitle = "Alpiplan-App"
                if let note = call.getString("note")?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
                    contact.note = note
                }
                if let phone = call.getString("phone")?.trimmingCharacters(in: .whitespacesAndNewlines), !phone.isEmpty {
                    if let existing = self.lookupContacts(phone: phone).first {
                        DispatchQueue.main.async {
                            call.resolve([
                                "contactId": existing.identifier,
                                "displayName": existing.displayName,
                                "found": true
                            ])
                        }
                        return
                    }
                    contact.phoneNumbers = [
                        CNLabeledValue(label: CNLabelPhoneNumberMobile, value: CNPhoneNumber(stringValue: phone))
                    ]
                }

                let saveRequest = CNSaveRequest()
                saveRequest.add(contact, toContainerWithIdentifier: self.localContainerId(store))
                try store.execute(saveRequest)
                result = ["contactId": contact.identifier]
            } catch {
                DispatchQueue.main.async {
                    call.reject("Failed to save local contact", error.localizedDescription, error)
                }
                return
            }
            DispatchQueue.main.async {
                call.resolve(result)
            }
        }
    }

    @objc func findContactByPhone(_ call: CAPPluginCall) {
        guard contactsAuthorized() else {
            call.resolve(["found": false])
            return
        }
        let phone = call.getString("phone")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        DispatchQueue.global(qos: .userInitiated).async {
            let match = self.lookupContacts(phone: phone).first
            DispatchQueue.main.async {
                if let match {
                    call.resolve([
                        "found": true,
                        "contactId": match.identifier,
                        "displayName": match.displayName,
                        "googleSynced": false
                    ])
                } else {
                    call.resolve(["found": false])
                }
            }
        }
    }

    @objc func deleteContactByPhone(_ call: CAPPluginCall) {
        let store = CNContactStore()
        store.requestAccess(for: .contacts) { granted, error in
            if !granted {
                DispatchQueue.main.async {
                    call.reject(error?.localizedDescription ?? "Contacts permission denied")
                }
                return
            }
            let phone = call.getString("phone")?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if phone.isEmpty {
                DispatchQueue.main.async {
                    call.reject("Keine Telefonnummer")
                }
                return
            }
            do {
                let matches = self.lookupContacts(phone: phone)
                let saveRequest = CNSaveRequest()
                for match in matches {
                    let fetched = try store.unifiedContact(
                        withIdentifier: match.identifier,
                        keysToFetch: [CNContactIdentifierKey as CNKeyDescriptor]
                    )
                    saveRequest.delete(fetched.mutableCopy() as! CNMutableContact)
                }
                if !matches.isEmpty {
                    try store.execute(saveRequest)
                }
                DispatchQueue.main.async {
                    call.resolve(["deleted": matches.count])
                }
            } catch {
                DispatchQueue.main.async {
                    call.reject("Failed to delete contact", error.localizedDescription, error)
                }
            }
        }
    }

    @objc func showLocalNotification(_ call: CAPPluginCall) {
        let content = UNMutableNotificationContent()
        content.title = call.getString("title") ?? "Alpiplan"
        content.body = call.getString("body") ?? ""
        content.sound = .default
        let id = call.getString("id")?.trimmingCharacters(in: .whitespacesAndNewlines)
        let identifier = (id?.isEmpty == false) ? id! : UUID().uuidString
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request) { _ in
            // Missing permission is not an error for callers; they keep the in-app alert.
            call.resolve()
        }
    }

    @objc func getPushToken(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            guard Self.notificationsAllowed(settings.authorizationStatus) else {
                call.resolve([:])
                return
            }
            DispatchQueue.main.async {
                if let cached = UserDefaults.standard.string(forKey: Self.pushTokenDefaultsKey), !cached.isEmpty {
                    UIApplication.shared.registerForRemoteNotifications()
                    call.resolve(["token": cached])
                    return
                }
                self.awaitPushToken(call)
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    private func awaitPushToken(_ call: CAPPluginCall) {
        var observer: NSObjectProtocol?
        var finished = false
        let finish: ([String: Any]) -> Void = { result in
            guard !finished else { return }
            finished = true
            if let observer {
                NotificationCenter.default.removeObserver(observer)
            }
            call.resolve(result)
        }
        observer = NotificationCenter.default.addObserver(
            forName: .alpiplanPushToken,
            object: nil,
            queue: .main
        ) { note in
            if let token = note.userInfo?["token"] as? String, !token.isEmpty {
                finish(["token": token])
            }
        }
        // No Firebase config in this build, or APNs registration failed: resolve empty like Android.
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.pushTokenTimeout) {
            finish([:])
        }
    }

    private static func notificationsAllowed(_ status: UNAuthorizationStatus) -> Bool {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return true
        default:
            return false
        }
    }

    private static func notificationState(_ status: UNAuthorizationStatus) -> String {
        if notificationsAllowed(status) {
            return "granted"
        }
        return status == .denied ? "denied" : "prompt"
    }

    @objc func startSpeechRecognition(_ call: CAPPluginCall) {
        call.reject("startSpeechRecognition is Android-only")
    }

    @objc func stopSpeechRecognition(_ call: CAPPluginCall) {
        call.resolve()
    }

    private func resolvePermissionStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            var status = self.permissionStatus()
            status["notifications"] = Self.notificationState(settings.authorizationStatus)
            DispatchQueue.main.async {
                call.resolve(status)
            }
        }
    }

    private func permissionStatus() -> [String: String] {
        let mic: String
        switch AVAudioSession.sharedInstance().recordPermission {
        case .granted:
            mic = "granted"
        case .denied:
            mic = "denied"
        default:
            mic = "prompt"
        }
        return [
            "microphone": mic,
            "contacts": contactsAuthorized() ? "granted" : contactsPromptOrDenied()
        ]
    }

    private func contactsAuthorized() -> Bool {
        let status = CNContactStore.authorizationStatus(for: .contacts)
        if status == .authorized {
            return true
        }
        // CNAuthorizationStatus.limited (iOS 18) rawValue is 4.
        return status.rawValue == 4
    }

    private func contactsPromptOrDenied() -> String {
        switch CNContactStore.authorizationStatus(for: .contacts) {
        case .denied, .restricted:
            return "denied"
        default:
            return "prompt"
        }
    }

    private struct PhoneContactMatch {
        let identifier: String
        let displayName: String
    }

    private func lookupContacts(phone: String) -> [PhoneContactMatch] {
        let needle = phone.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !needle.isEmpty else { return [] }
        let store = CNContactStore()
        let keys: [CNKeyDescriptor] = [
            CNContactIdentifierKey as CNKeyDescriptor,
            CNContactGivenNameKey as CNKeyDescriptor,
            CNContactFamilyNameKey as CNKeyDescriptor,
            CNContactOrganizationNameKey as CNKeyDescriptor,
            CNContactPhoneNumbersKey as CNKeyDescriptor
        ]
        var matches: [PhoneContactMatch] = []
        let request = CNContactFetchRequest(keysToFetch: keys)
        do {
            try store.enumerateContacts(with: request) { contact, _ in
                let hit = contact.phoneNumbers.contains { labeled in
                    Self.phonesMatch(labeled.value.stringValue, needle)
                }
                guard hit else { return }
                let name = [contact.givenName, contact.familyName]
                    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                    .filter { !$0.isEmpty }
                    .joined(separator: " ")
                let display = name.isEmpty ? contact.organizationName : name
                matches.append(PhoneContactMatch(identifier: contact.identifier, displayName: display))
            }
        } catch {
            return []
        }
        return matches
    }

    private static func phonesMatch(_ a: String, _ b: String) -> Bool {
        let x = digits(a)
        let y = digits(b)
        guard x.count >= 6, y.count >= 6 else { return false }
        if x == y { return true }
        return x.hasSuffix(String(y.suffix(8))) || y.hasSuffix(String(x.suffix(8)))
    }

    private static func digits(_ value: String) -> String {
        value.filter { $0.isNumber }
    }

    private func localContainerId(_ store: CNContactStore) -> String? {
        let containers = (try? store.containers(matching: nil)) ?? []
        return containers.first(where: { $0.type == .local })?.identifier
    }
}
