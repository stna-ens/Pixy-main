package com.pixelart.mobile;

import com.getcapacitor.BridgeActivity;

import android.view.KeyEvent;

public class MainActivity extends BridgeActivity {
    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        if (event.getKeyCode() == KeyEvent.KEYCODE_BUTTON_STYLUS_PRIMARY && event.getAction() == KeyEvent.ACTION_UP) {
            this.getBridge().triggerJSEvent("pencilDoubleTap", "window");
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
