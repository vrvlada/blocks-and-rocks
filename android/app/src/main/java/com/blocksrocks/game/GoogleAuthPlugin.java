package com.blocksrocks.game;

import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.tasks.Task;

@CapacitorPlugin(name = "GoogleAuth")
public class GoogleAuthPlugin extends Plugin {

    private static final String WEB_CLIENT_ID = "556570853814-42pn5174etkj86srceviqai3l701aofr.apps.googleusercontent.com";
    private GoogleSignInClient googleSignInClient;

    private String getServerClientId() {
        String clientId = getConfig().getString("serverClientId");
        if (clientId != null && !clientId.trim().isEmpty()) {
            return clientId.trim();
        }
        try {
            int resId = getContext().getResources().getIdentifier("server_client_id", "string", getContext().getPackageName());
            if (resId != 0) {
                return getContext().getString(resId);
            }
        } catch (Exception ignored) {}
        return WEB_CLIENT_ID;
    }

    private GoogleSignInClient getClient() {
        if (googleSignInClient == null) {
            GoogleSignInOptions gso = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                    .requestIdToken(getServerClientId())
                    .requestEmail()
                    .requestProfile()
                    .build();
            googleSignInClient = GoogleSignIn.getClient(getActivity(), gso);
        }
        return googleSignInClient;
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        try {
            getClient();
            call.resolve();
        } catch (Exception e) {
            call.reject("Initialize failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        try {
            GoogleSignInClient client = getClient();
            Intent signInIntent = client.getSignInIntent();
            startActivityForResult(call, signInIntent, "handleSignInResult");
        } catch (Exception e) {
            call.reject("Failed to initiate Google Sign-In: " + e.getMessage(), e);
        }
    }

    @ActivityCallback
    private void handleSignInResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        try {
            Intent data = result.getData();
            Task<GoogleSignInAccount> task = GoogleSignIn.getSignedInAccountFromIntent(data);
            GoogleSignInAccount account = task.getResult(ApiException.class);
            if (account != null) {
                JSObject ret = formatAccountResponse(account);
                call.resolve(ret);
            } else {
                call.reject("Google Sign-In returned null account");
            }
        } catch (ApiException e) {
            int statusCode = e.getStatusCode();
            if (statusCode == 12501) { // SIGN_IN_CANCELLED
                call.reject("cancelled");
            } else {
                call.reject("Google Sign-In failed with status code " + statusCode + ": " + e.getMessage(), String.valueOf(statusCode), e);
            }
        } catch (Exception e) {
            call.reject("Unexpected error during Google Sign-In: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getSilentAccount(PluginCall call) {
        try {
            GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
            if (account != null) {
                JSObject ret = formatAccountResponse(account);
                call.resolve(ret);
            } else {
                JSObject ret = new JSObject();
                ret.put("signedIn", false);
                call.resolve(ret);
            }
        } catch (Exception e) {
            call.reject("Silent account check failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void refresh(PluginCall call) {
        try {
            GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
            if (account != null) {
                JSObject ret = formatAccountResponse(account);
                call.resolve(ret);
            } else {
                call.reject("No active signed in account");
            }
        } catch (Exception e) {
            call.reject("Refresh failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        try {
            GoogleSignInClient client = getClient();
            client.signOut().addOnCompleteListener(getActivity(), task -> {
                JSObject ret = new JSObject();
                ret.put("success", true);
                call.resolve(ret);
            });
        } catch (Exception e) {
            call.reject("Sign out failed: " + e.getMessage(), e);
        }
    }

    private JSObject formatAccountResponse(GoogleSignInAccount account) {
        JSObject ret = new JSObject();
        ret.put("signedIn", true);
        ret.put("userId", account.getId() != null ? account.getId() : "");
        ret.put("email", account.getEmail() != null ? account.getEmail() : "");
        ret.put("displayName", account.getDisplayName() != null ? account.getDisplayName() : "");
        ret.put("givenName", account.getGivenName() != null ? account.getGivenName() : "");
        ret.put("familyName", account.getFamilyName() != null ? account.getFamilyName() : "");
        ret.put("photoUrl", account.getPhotoUrl() != null ? account.getPhotoUrl().toString() : "");
        ret.put("idToken", account.getIdToken() != null ? account.getIdToken() : "");

        JSObject authObj = new JSObject();
        authObj.put("idToken", account.getIdToken() != null ? account.getIdToken() : "");
        authObj.put("accessToken", "");
        ret.put("authentication", authObj);

        return ret;
    }
}
