package io.github.nosugark.scankick

import android.graphics.Color
import android.os.Bundle
import android.view.View
import androidx.activity.enableEdgeToEdge
import androidx.core.graphics.Insets
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

class MainActivity : TauriActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Android WebView cannot enter element fullscreen, so the app stays immersive itself.
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        val content = findViewById<View>(android.R.id.content)
        // Padding around the cutout shows this instead of the white window background.
        content.setBackgroundColor(Color.parseColor("#0d1f16"))
        ViewCompat.setOnApplyWindowInsetsListener(content) { view, insets ->
            val types = WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            val safe = insets.getInsets(types)
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom)
            // The native container owns these insets; keep IME insets for the WebView.
            WindowInsetsCompat.Builder(insets)
                .setInsets(types, Insets.NONE)
                .setInsetsIgnoringVisibility(types, Insets.NONE)
                .setDisplayCutout(null)
                .build()
        }
        ViewCompat.requestApplyInsets(content)
    }
}
