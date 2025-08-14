'use strict';

(function() {
    function loadComponent(name) {
        import(`/js/components/${name}.mjs`);
    }

    loadComponent('feature-indicators');
    loadComponent('magic-wheel');
    loadComponent('map-scale');
    loadComponent('mini-map');
    loadComponent('modal-box');
    loadComponent('scan-progress');
})();
