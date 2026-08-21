package com.blocksrocks.game;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;
import com.google.android.gms.games.Player;

@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {

    @Override
    public void load() {
        super.load();
        // Inicijalizacija Play Games SDK v2
        PlayGamesSdk.initialize(getContext());
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String webClientId = call.getString("webClientId"); // Dobija se iz Google Cloud-a
        
        if (webClientId == null || webClientId.isEmpty()) {
            call.reject("Missing webClientId");
            return;
        }

        PlayGames.getGamesSignInClient(getActivity())
            .requestServerSideAccess(webClientId, false)
            .addOnCompleteListener(task -> {
                if (task.isSuccessful()) {
                    String serverAuthCode = task.getResult();
                    
                    // Pokušavamo da dohvatimo i Gamer Tag (Display Name)
                    PlayGames.getPlayersClient(getActivity()).getCurrentPlayer()
                        .addOnCompleteListener(playerTask -> {
                            JSObject ret = new JSObject();
                            ret.put("serverAuthCode", serverAuthCode);
                            if (playerTask.isSuccessful() && playerTask.getResult() != null) {
                                ret.put("displayName", playerTask.getResult().getDisplayName());
                            } else {
                                ret.put("displayName", "");
                            }
                            call.resolve(ret);
                        });
                } else {
                    String errorMessage = task.getException() != null ? task.getException().getMessage() : "Unknown error";
                    call.reject("Play Games SignIn failed: " + errorMessage);
                }
            });
    }
}
