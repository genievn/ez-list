(function() {
'use strict';

angular.module('ez.list', [])
.constant('EzListConfig', {
    mode: 'insert', // [insert, drop, disabled]
    acceptClass: 'ez-dragging', // item class to accept in dropzones
    idField: 'id',
    listChildrenField: 'items',
    childrenField: 'items',
    collapsedField: 'collapsed',
    showPlaceholder: true, // show placeholder where item will drop
    collapsed: true, // initial item collapsed state
    allowDrag: true, // allow items to be draggable
    allowNesting: true, // allow items to be nested inside one another, only applicable when mode = insert
    openOnSlide: true, // open an item when a drag item is slid under and to the right
    closeOnDrag: false, // close item on drag init
    dropOnly: false, // only allow dragged items to be dropped on 1st level items
    xThreshold: 15, // Amount of drag (in px) required for left - right movement
    yThreshold: 5, // Amount of drag (in px) required for up - down movement
    api: { // allow user to add callbacks to significant events
      onMove: null, // called when an item is moved
      onDrop: null // called when an item is dropped onto another
    },
    transcludeMethods: {} // allow for binding methods to the transcluded scope
}).directive('ezList', ['EzListConfig', 'Draggable', function(EzListConfig, Draggable) {
    return {
      restrict: 'A',
      replace: true,
      transclude: true,
      scope: {
        item: '=?ezList',
        config: '=?',
        selectedItems: '=?'
      },
      template: '<div class="ez-list" ng-class="{\'ez-list-draggable\': options.allowDrag, \'ez-list-dropable\': options.mode == \'drop\', \'ez-no-placeholder\': !options.showPlaceholder, \'ez-droponly\': options.dropOnly, \'ez-list-empty\': !hasItems}">' +
        '<ul class="ez-list-items">' +
          '<li class="ez-list-item" ng-repeat="item in item[options.childrenField]" ng-include="\'ez-list-tpl.html\'"></li>' +
        '</ul>' +
        '</div>',
      link: function(scope, $element, attrs, ctrl, transclude) {
        scope.options = angular.extend({}, EzListConfig, scope.config);

        // give child items access to the transclude
        scope.options.transclude = transclude;

        scope.depth = 0;

        for (var k in scope.options.transcludeMethods) {
          scope[k] = scope.options.transcludeMethods[k];
        }

        var element = $element[0];

        if (scope.options.mode === 'drop') {
          scope.options.allowNesting = false;
          scope.options.openOnSlide = false;
          scope.options.showPlaceholder = false;
        }

        scope.$watch('selectedItems', function(newVal, oldVal) {
          if (newVal !== oldVal) {
            scope.$broadcast('ez_list.selected_changed');
          }
        });

        if (!scope.item) {
          scope.item = {};
          scope.hasItems = false;

          $element.addClass('has-dropzone');
          Draggable.setDropzone(element, scope.options);
        } else {
          scope.$watchCollection('item.' + scope.options.childrenField, function(newVal) {
            scope.hasItems = newVal && newVal.length;

            if (newVal && newVal.length > 0 && $element.hasClass('has-dropzone')) {
              $element.removeClass('has-dropzone');
              Draggable.unsetDropzone(element);
            }

            if (!newVal && !$element.hasClass('has-dropzone')) {
              $element.addClass('has-dropzone');
              Draggable.setDropzone(element, scope.options);
            }
          });
        }

      }
    };
}])
.directive('ezListItemContent', ['Draggable', function(Draggable) {
    return {
      restrict: 'C',
      link: function (scope, $element) {
        var element = $element[0];

        if (scope.options.allowDrag === true || (typeof scope.options.allowDrag === 'function' && scope.options.allowDrag(scope.item))) {
          Draggable.initDragItem(element, scope);
        }

        scope.item._parentItem = scope.$parent.$parent.item;

        if (scope.options.transclude) {
          // add transcluded item content
          scope.options.transclude(scope, function(clone) {
            $element.append(clone);
          });
        }

        var recurseParents = function(item) {
          if (item.hasOwnProperty('_parentItem')) {
            recurseParents(item._parentItem);
          }

          item._active = true;
        };

        var setSelected = function() {
          if (!scope.selectedItems) {
            return;
          }

          if (Array.isArray(scope.selectedItems)) {
            if ($.grep(scope.selectedItems, function(item) {
              if (typeof item === 'string') {
                return scope.item[scope.options.idField] === item ? true : false;
              } else {
                return !!item && item[scope.options.idField] === scope.item[scope.options.idField] ? true : false;
              }
            }).length) {
              scope.item._selected = true;
              recurseParents(scope.item, true);
            }
          } else if (typeof scope.selectedItems === 'string' && scope.selectedItems === scope.item[scope.options.idField]) {
              scope.item._selected = true;
              recurseParents(scope.item, true);
          } else if (scope.selectedItems[scope.options.idField] === scope.item[scope.options.idField]) {
              scope.item._selected = true;
              recurseParents(scope.item, true);
          }
        };

        if (!scope.item.hasOwnProperty('collapsed')) {
          scope.item[scope.options.collapsedField] = scope.options.collapsed;
        }

        scope.$watchCollection('item.' + scope.options.childrenField, function(newVal) {
          scope.hasItems = newVal && newVal.length;
        });

        scope.remove = function() {
          scope.$parent.$parent.item[scope.options.childrenField].splice(scope.$parent.$parent.item[scope.options.childrenField].indexOf(scope.item), 1);
        };

        scope.$on('ez_list.selected_changed', function() {
          delete scope.item._active;
          delete scope.item._selected;
          setSelected();
        });

        // init
        setSelected();
      }
    };
}])
.factory('Draggable', [function() {
    var dragItem,
        dragItemEl,
        $dragItemEl,
        dragItemList,
        dragItemListEl,
        dragItemListScope,
        dragItemIndex,
        dragContainerEl = angular.element('<ul class="ez-drag-container"></ul>')[0], // drag container element
        placeholderEl = angular.element('<li class="ez-placeholder"></li>')[0], // placeholder element
        dragX = 0, // x coordinate of drag element
        dragY = 0, // y coordinate of drag element
        dragDx = 0,
        dragDy = 0,
        dragMoveX = 0, // number of moves in the x direction
        dragDirectionX,
        dragDirectionY,
        dropItemEl,
        $dropItemEl,
        dropItem,
        dropInteracts,
        prevDragDirectionX, // which way the item is being dragged ['left', 'right']
        listContainerEl,
        $listContainerEl,
        listContainerScope,
        prevListContainerEl,
        $prevListContainerEl,
        prevListContainerScope,
        dragOptions = {};

    return {

      setDropzones: function() {
        $dragItemEl.find('.ez-list-item-content').removeClass('ez-dropzone');

        dropInteracts = interact('.ez-dropzone').dropzone({
          ondragenter: this.enter.bind(this),
          ondragleave: this.leave.bind(this),
        });
      },

      setDropzone: function(el, options) {
        interact(el).dropzone({
          accept: options.accept,
          ondragenter: this.enter.bind(this),
          ondragleave: this.leave.bind(this),
        });

      },

      unsetDropzone: function(el) {
        interact(el).dropzone(false);
      },

      unsetDropzones: function() {
        dropInteracts.unset();

        $dragItemEl.find('.ez-list-item-content').addClass('ez-dropzone');
      },

      initDragItem: function(element, scope) {
        var self = this;
        interact(element).draggable({
          manualStart: true,
          onstart: function(e) {
            self.start(e, scope);
          },
          onmove: function(e) {
            self.move(e);
          },
          onend: function(e) {
            self.end(e);
          }
        })
        .on('down', function (e) {
          var interaction = e.interaction;
          if (
            !e.target.hasAttribute('ez-drag-handle') || // must have drag-handle attribute
            (typeof e.button !== 'undefined' && e.button !== 0) || // disable right click
            interaction.interacting() // must not already be interacting
          ) {
            return;
          }

          interaction.start({ name: 'drag' }, e.interactable, e.currentTarget);

        });
      },

      /**
       * Fires once when an item enters another
       */
      enter: function(e) {
        var _listContainerEl;

        if (angular.element(e.target).hasClass('ez-list')) {
          // drop target is an empty list
          _listContainerEl = e.target;

          this.setDropItem(e.target);
        } else {
          this.setDropItem(e.target.parentNode.parentNode);

          dropItemEl.children[0].children[0].classList.add('ez-dragover');

          _listContainerEl = $dropItemEl.closest('.ez-list')[0];
        }

        if (_listContainerEl !== listContainerEl) {
          if (listContainerEl) {
            prevListContainerEl = listContainerEl;
            $prevListContainerEl = $listContainerEl;
            prevListContainerScope = listContainerScope;

            prevListContainerEl.classList.remove('ez-list-target');
          }

          listContainerEl = _listContainerEl;
          $listContainerEl = angular.element(listContainerEl);
          listContainerScope = $listContainerEl.isolateScope();

          listContainerEl.classList.add('ez-list-target');

          _listContainerEl = null;
        }
      },

      /**
       * Fires once when an item leaves another
       */
      leave: function() {
        if ($dropItemEl.hasClass('ez-list-item')) {
          dropItemEl.children[0].children[0].classList.remove('ez-dragover');
        }

        if ($dropItemEl.hasClass('ez-list')) {
          // drop target was an empty list
          listContainerEl.classList.remove('ez-list-target');
        } else {
          // drop target was a list item

          if (listContainerScope.options.mode === 'insert') {
            if (dragDirectionY === 'up') {
              this.moveUp();
            } else {
              this.moveDown();
            }
          }
        }

        dropItem = dropItemEl = $dropItemEl = null;

        if (listContainerScope.options.dropOnly) {
          listContainerEl.classList.remove('ez-list-target');
          listContainerEl = $listContainerEl =listContainerScope = null;
        }
      },

      start: function(e, scope) {
        e.preventDefault();
        e.stopPropagation();

        $dragItemEl = angular.element(e.target).closest('.ez-list-item');
        dragItemEl = $dragItemEl[0];
        dragItemListEl = $dragItemEl[0].parentNode;
        $listContainerEl = $(e.target).closest('.ez-list');
        listContainerEl = $listContainerEl[0];
        listContainerScope = $listContainerEl.isolateScope();

        this.setDropzones();

        dragOptions = listContainerScope.options;
        dragItem = scope.item;
        dragItemListScope = scope.$parent.$parent;
        dragItemList = dragItemListScope.item;
        dragItemIndex = dragItemList[listContainerScope.options.childrenField].indexOf(dragItem);

        this.initDragContainer();

        if (dragOptions.closeOnDrag) {
          dragItem[dragOptions.collapsedField] = true;
          dragItemListScope.$apply();
        } else {
          placeholderEl.style.height = $dragItemEl.height() + 'px';
        }

        // prevent nested items within the dragged item from being accepted by a dropzone
        $dragItemEl.addClass(listContainerScope.options.acceptClass);

        dragItemListEl.insertBefore(placeholderEl, dragItemEl);

        if (dragContainerEl.parentNode !== listContainerEl) {
          listContainerEl.appendChild(dragContainerEl);
        }

        dragContainerEl.appendChild(dragItemEl);

        $listContainerEl.addClass('ez-drag-origin');
        $listContainerEl.addClass('ez-list-target');

        interact.dynamicDrop(true);

        $dragItemEl.addClass('ez-dragging');

      },

      move: function(e) {
        dragDx = dragDx + e.dx;
        dragDy = dragDy + e.dy;

        this.setDragContainerElPosition();

        if (listContainerEl === null || listContainerScope.options.mode !== 'insert') {
          return;
        }

        if (listContainerScope.options.allowNesting && e.dx !== 0 && e.dy === 0) {
          if (e.dx > 0) {
            dragDirectionX = 'right';
          } else {
            dragDirectionX = 'left';
          }

          if (prevDragDirectionX !== dragDirectionX) {
            dragMoveX = 0;
            prevDragDirectionX = dragDirectionX;
          }

          dragMoveX = dragMoveX + Math.abs(e.dx);

          // reduce jumping by requiring min drag movement for a direction change
          if (dragMoveX > listContainerScope.options.xThreshold) {
            dragMoveX = 0;

            if (dragDirectionX === 'right') {
              this.moveRight();
            } else {
              this.moveLeft();
            }

            return;
          }
        }

        // disable y movement if movement is significant in x direction
        if (!dropItemEl || Math.abs(e.dx) > 5 || e.dy === 0) {
          return;
        }

        if (e.dy > 0) {
          dragDirectionY = 'down';
        } else {
          dragDirectionY = 'up';
        }
      },

      /**
       * Drag end handler
       */
      end: function() {
        var self = this;
        interact.dynamicDrop(false);

        if (!!dropItemEl && $dropItemEl.hasClass('ez-list-item')) {
          dropItemEl.children[0].children[0].classList.remove('ez-dragover');
        }

        // remove dragItem from model
        dragItemList[dragOptions.childrenField].splice(dragItemIndex, 1);
        dragItemListScope.$apply();

        this.removeDragElement();

        if (!listContainerEl) {

          this.returnItem(true);

        } else if (listContainerScope.options.mode === 'insert' && !!placeholderEl.parentNode) {

          this.setDropItem(placeholderEl.parentNode);

          if (typeof dragItemListScope.options.api.onMove === 'function') {
            listContainerScope.options.api.onMove(dragItem, dropItem).then(function() {
              self.moveItem();
            }, function() {
              self.returnItem();
            });
          } else {
            self.moveItem(true);
          }

        } else if (listContainerScope.options.mode === 'drop') {
          if (typeof listContainerScope.options.api.onDrop === 'function') {
            listContainerScope.options.api.onDrop(dragItem, dropItem).then(function() {
              self.destroy();
            }, function() {
              self.returnItem();
            });
          }

        } else {
          this.returnItem(true);
        }
      },

      /**
       * Move an item on the list model
       */
      moveItem: function(useApply) {
        var self = this;

        // add drag item to target items array
        if (dropItem.hasOwnProperty(listContainerScope.options.childrenField)) {
          var index = Array.prototype.indexOf.call(placeholderEl.parentNode.children, placeholderEl);

          dropItem[listContainerScope.options.childrenField].splice(index, 0, dragItem);
        } else {
          dropItem[listContainerScope.options.childrenField] = [dragItem];
        }

        if (useApply) {
          dragItemListScope.$apply();
        }

        self.destroy();
      },

      /**
       * Remove the drag item from the drag container
       */
      removeDragElement: function() {
        dragContainerEl.removeChild(dragItemEl);
      },

      /**
       * Remove placeholder
       */
      removePlaceholder: function() {
        if (placeholderEl.parentNode) {
          placeholderEl.parentNode.removeChild(placeholderEl);
        }
      },

      /**
       * Return item back to origin
       */
      returnItem: function(useApply) {
        dragItemList[dragOptions.childrenField].splice(dragItemIndex, 0, dragItem);

        if (useApply) {
          dragItemListScope.$apply();
        }

        this.destroy();
      },

      /**
       * Initialize the drag container position
       */
      initDragContainer: function() {
        var listContainerPosition = listContainerEl.getBoundingClientRect();
        var dragPosition = dragItemEl.getBoundingClientRect();

        dragDx = 0;
        dragDy = 0;
        dragX = dragPosition.left - listContainerPosition.left;
        dragY = dragPosition.top - listContainerPosition.top;

        dragContainerEl.style.top = (dragY + 2) + 'px';
        dragContainerEl.style.left = (dragX + 2) + 'px';
        dragContainerEl.style.width = (dragPosition.right - dragPosition.left - 1) + 'px';
        this.setDragContainerElPosition();
      },

      setDropItem: function(el) {
        dropItemEl = el;
        $dropItemEl = angular.element(el);
        dropItem = $dropItemEl.scope().item;
      },

      /**
       * Set transform style on drag container element
       */
      setDragContainerElPosition: function() {
        dragContainerEl.style.webkitTransform = dragContainerEl.style.transform = 'translate3D(' + dragDx + 'px, ' + dragDy + 'px, 0px)';
      },

      /**
       * Move placeholder to the left
       */
      moveLeft: function() {
        if (placeholderEl.nextElementSibling) { // only allow left if placeholder is last
          return;
        }

        this.setDropItem(placeholderEl.parentNode.parentNode.parentNode);

        if (!dropItem || !dropItemEl || !dropItemEl.nextSibling) {
          return;
        }

        dropItemEl.parentNode.insertBefore(placeholderEl, dropItemEl.nextSibling);
      },

      /**
       * Move placeholder to the right
       */
      moveRight: function() {
        if (!placeholderEl.previousElementSibling) {
          return;
        }

        this.setDropItem(placeholderEl.previousElementSibling);

        if (listContainerScope.options.openOnSlide && dropItem[listContainerScope.options.collapsedField] === true) {
          dropItem[listContainerScope.options.collapsedField] = false;

          listContainerScope.$apply();

          dropItemEl.children[0].children[1].insertBefore(placeholderEl, dropItemEl.children[0].children[1].children[0]);
        } else {
          dropItemEl.children[0].children[1].appendChild(placeholderEl);
        }
      },

      /**
       * Move placeholder up
       */
      moveUp: function() {
          dropItemEl.parentNode.insertBefore(placeholderEl, dropItemEl);
      },

      /**
       * Move placeholder down
       */
      moveDown: function() {
          var innerList = dropItemEl.children[0].children[1];

          if (innerList && innerList.children[0]) {
            // move in if list is not collapsed
            innerList.insertBefore(placeholderEl, innerList.children[0]);
          } else {
            dropItemEl.parentNode.insertBefore(placeholderEl, dropItemEl.nextElementSibling);
          }
      },

      /**
       * Clean up
       */
      destroy: function() {
        this.removePlaceholder();

        $dragItemEl.removeClass(dragOptions.acceptClass);

        if (listContainerEl) {
          listContainerEl.classList.remove('ez-drag-origin');
          listContainerEl.classList.remove('ez-list-target');
        }

        if (prevListContainerEl) {
          prevListContainerEl.classList.remove('ez-drag-origin');
          prevListContainerEl.classList.remove('ez-list-target');
        }

        this.unsetDropzones();

        prevListContainerEl = $prevListContainerEl = prevListContainerScope = listContainerEl = $listContainerEl = listContainerScope = $dragItemEl = dragItemEl = dragItemList = dragItemListEl = dragItem = dragItemIndex = null;
      }

    };

}])

})();
