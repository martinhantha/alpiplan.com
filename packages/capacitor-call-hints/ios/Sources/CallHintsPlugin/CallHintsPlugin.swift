import Foundation
import Capacitor

@objc(CallHintsPlugin)
public class CallHintsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CallHintsPlugin"
    public let jsName = "CallHints"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getRecentCallHints", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestPermissions", returnType: CAPPluginReturnPromise)
    ]

    @objc func getRecentCallHints(_ call: CAPPluginCall) {
        call.resolve([
            "hints": []
        ])
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        call.resolve([
            "callerId": "denied"
        ])
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        call.resolve([
            "callerId": "denied"
        ])
    }
}
