'use strict';

(function() {
    function loadComponent(name) {
        import(`/js/components/${name}.mjs`);
    }

    loadComponent('feature-indicators');
    loadComponent('map-scale');
    loadComponent('mini-map');
    loadComponent('modal-box');
})();
