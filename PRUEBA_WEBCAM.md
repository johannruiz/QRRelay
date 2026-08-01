# Prueba con webcam USB

1. Abre la aplicación desde GitHub Pages mediante HTTPS en las dos ventanas.
2. En la ventana emisora selecciona **USB Webcam** y muestra el QR a pantalla completa.
3. Coloca las ventanas lado a lado sin minimizar ni ocultar la ventana emisora.
4. Apunta la webcam al monitor y haz que el QR ocupe al menos la mitad de la imagen.
5. Evita reflejos y ajusta la distancia hasta que los bordes del QR se vean nítidos.

Los perfiles de esta versión son **USB Webcam (8 QR/s)**, **Balanced (14 QR/s)** y **Fast (20 QR/s)**. Empieza con Balanced; usa Fast cuando el QR ocupe buena parte de la imagen y la cámara mantenga el enfoque.

El modo **Custom / Lab** permite ajustar densidad, velocidad y corrección L/M/Q/H. Los valores marcados como `HIGH` o `EXTREME` son límites experimentales y normalmente requieren pantalla completa, enfoque estable y una cámara de alta velocidad.

El receptor mostrará cuántos frames de cámara ha analizado. Si ese número aumenta pero `QR READS` sigue en cero, el problema es de enfoque, tamaño, exposición o reflejo. Si `QR READS` aumenta, el lector ya reconoció la señal y `NEW FRAMES` debe comenzar a avanzar.

Esta es la versión 0.5.0. No uses una pestaña que todavía muestre una versión anterior en el pie de página.
