/**
 * Parent component for A-Frame.
 * Works around A-Frame's lack of any ability to change an entity's parent by
 * updating an entity's position every frame as if it were actually parented to
 * another entity.
 * See: https://glitch.com/edit/#!/aframe-parent-constraint
 * See also: https://github.com/aframevr/aframe/issues/2425
 */

AFRAME.registerComponent('parent-constraint', {
    //dependencies: ['mdmu-gltf', 'mdmu-controls'],
    schema: {
        parent:                 {type: "selector", default:null},
        position:               {type: "boolean",  default:true},
        rotation:               {type: "boolean",  default:true},
        scale:                  {type: "boolean",  default:true},
        copyParentTransforms:   {type: "boolean",  default:false}, //just want it to match all transforms of "parent" (overrides everything else)
        maintainOffset:         {type: "boolean",  default:false}
    },
    multiple: false, //do not allow multiple instances of this component on this entity
    init: function() {
        this.psuedoParent = null;
    },
    update: function(oldData)  {
        const Context_AF    = this;
        const data = this.data;

        if (Object.keys(data).length === 0) { return; } // No need to update. as nothing here yet

        //model change
        if ( (oldData.parent !== data.parent) && data.parent !== null ) {

            //have to keep checking if everything is ready first ...
            let loopCounter = 0;
            const checkChildParentLoadStatus = () => {
                Context_AF.psuedoParent = document.querySelector('#' + data.parent.getAttribute('id'));
                if (Context_AF.psuedoParent !== null) {
                    if ( Context_AF.psuedoParent.hasLoaded && Context_AF.el.hasLoaded ) {
                        Context_AF.setupConstraint();
                        clearInterval(constraintLoop);
                    }
                }

                if (++loopCounter > 20) {
                    console.log( "Warning! : problems setting parentConstraint" );
                    clearInterval(constraintLoop);
                }
            };
            const constraintLoop = setInterval(checkChildParentLoadStatus, 100);

            // document.querySelector('a-scene').addEventListener('loaded', () => {
            //     Context_AF.setupConstraint();
            // });
        }

        //remove this component if you want to break constraint .... setting to null will do nothing. 
        //To disable temporary set position, rotation, scale to false ..
    },
    setupConstraint: function () {
        const Context_AF    = this;
        const data = this.data;
        
        Context_AF.originalWorldTransform         = Context_AF.el.object3D.matrixWorld.clone();
        Context_AF.originalLocalTransform         = Context_AF.el.object3D.matrix.clone();
        //Context_AF.originalLocalTransform.compose(Context_AF.el.object3D.position, Context_AF.el.object3D.quaternion, Context_AF.el.object3D.scale); //save for later

        console.log( this.originalWorldTransform );

        let position_P              = new THREE.Vector3();
        let position_C              = new THREE.Vector3();
        let rotation_P              = new THREE.Quaternion();
        let rotation_C              = new THREE.Quaternion();
        let scale_P                 = new THREE.Vector3();
        let scale_C                 = new THREE.Vector3();

        Context_AF.psuedoParent.object3D.matrixWorld.decompose(position_P, rotation_P, scale_P);
        Context_AF.el.object3D.matrixWorld.decompose(position_C, rotation_C, scale_C); //apply saved local transform

        //save transform offset between pseudo-parent and this object
        Context_AF.diffPos = position_C.clone();
        Context_AF.diffPos.sub(position_P);

        //get rot diff. QTransition = QFinal * QInitial^{-1} 
        //https://stackoverflow.com/questions/1755631/difference-between-two-quaternions
        Context_AF.diffQuat = rotation_C.clone();
        rotation_P.inverse();
        Context_AF.diffQuat.multiply(rotation_P);

        Context_AF.diffScale = scale_C.clone();
        Context_AF.diffScale.sub(scale_P);
        Context_AF.diffScale.x = Math.abs(Context_AF.diffScale.x);
        Context_AF.diffScale.y = Math.abs(Context_AF.diffScale.y);
        Context_AF.diffScale.z = Math.abs(Context_AF.diffScale.z);

        //Context_AF.el.object3D.matrixAutoUpdate   = false; //we want to manually update here and not have conflicts elsewhere
    },
    tick: function(time, timeDelta) {
        if (this.psuedoParent !== null) {
            const Context_AF    = this;
            const data          = Context_AF.data;

            let parentObject3D          = Context_AF.psuedoParent.object3D;
            let thisObject3D            = Context_AF.el.object3D;
            let worldMat_Constraint     = new THREE.Matrix4();
            let worldMat_NoConstraint   = new THREE.Matrix4();
            let position_P              = new THREE.Vector3();
            let position_C              = new THREE.Vector3();
            let rotation_P              = new THREE.Quaternion();
            let rotation_C              = new THREE.Quaternion();
            let scale_P                 = new THREE.Vector3();
            let scale_C                 = new THREE.Vector3();

            //get world matrix of pseudo-parent we want to constrain to
            worldMat_Constraint.copy( parentObject3D.matrixWorld ); 

            //get world matrix of this object if we didn't apply a constraint (taking into account local transform)
            worldMat_NoConstraint.copy( thisObject3D.parent.matrixWorld );         
            worldMat_NoConstraint.premultiply( this.originalLocalTransform );

            //break down into individual transforms ... thanks for the handy function THREEjs!
            worldMat_Constraint.decompose(position_P, rotation_P, scale_P);
            worldMat_NoConstraint.decompose(position_C, rotation_C, scale_C); //apply saved local transform

            //if we want to ignore constrain on one of these transforms we will "reset" it back to what it would be with no constraint applied
            if (!data.position) {
                position_P.copy(position_C);
            }

            if (!data.rotation) {
                rotation_P.copy(rotation_C);
            }

            if (!data.scale) {
                scale_P.copy(scale_C);
            } 

            //if we want to main offset else we don't
            if (data.copyParentTransforms) {
                //recompose world matrix with adjusted transforms
                worldMat_Constraint.compose(position_P, rotation_P, scale_P); 
            }
            else {
                let posMat = new THREE.Matrix4();
                let posMat_Off = new THREE.Matrix4();
                posMat.makeTranslation(position_P.x, position_P.y, position_P.z );
                posMat_Off.makeTranslation(this.diffPos.x, this.diffPos.y, this.diffPos.z );

                let rotMat = new THREE.Matrix4();
                let rotMat_Off = new THREE.Matrix4();
                rotMat.makeRotationFromQuaternion(rotation_P);
                rotMat_Off.makeRotationFromQuaternion(this.diffQuat);

                let scaleMat = new THREE.Matrix4();
                let scaleMat_Off = new THREE.Matrix4();
                if ( scale_P.length() > Number.EPSILON ) { //zero-vector will throw a bunch of errors here ...
                    scaleMat.makeScale(scale_P.x, scale_P.y, scale_P.z);
                }
                if ( this.diffScale.length() > Number.EPSILON ) {
                    scaleMat_Off.makeScale(this.diffScale.x, this.diffScale.y, this.diffScale.z);
                }

                worldMat_Constraint.identity();

                if ( data.maintainOffset ) {
                    if (data.rotation) { 
                        worldMat_Constraint.premultiply( rotMat_Off );
                    }
                    if (data.scale) {
                        worldMat_Constraint.premultiply( scaleMat_Off );
                    }
                    if (data.position) {
                        worldMat_Constraint.premultiply( posMat_Off );
                    }

                    if (data.rotation) { 
                        worldMat_Constraint.premultiply( rotMat );
                    }
                    if (data.scale) {
                        worldMat_Constraint.premultiply( scaleMat );
                    }
                    if (data.position) {
                        worldMat_Constraint.premultiply( posMat );
                    }
                }
                else {
                    if (data.scale) {
                        worldMat_Constraint.premultiply( scaleMat );
                        worldMat_Constraint.premultiply( scaleMat_Off );
                    }
                    if (data.rotation) { 
                        worldMat_Constraint.premultiply( rotMat );
                        worldMat_Constraint.premultiply( rotMat_Off );
                    }
                    if (data.position) {
                        worldMat_Constraint.premultiply( posMat );
                        worldMat_Constraint.premultiply( posMat_Off );
                    }
                }
            }

            //set new matrix and manually update
            const invOriginal = new THREE.Matrix4().getInverse(thisObject3D.matrix);
            thisObject3D.applyMatrix( invOriginal ); //reset this objects matrices
            thisObject3D.applyMatrix( worldMat_Constraint );
        }
    },
    remove: function() {
        //this.el.object3D.matrixAutoUpdate = true;   //give back control of update to framework
    }
}); 

/*

File License:

The MIT License

Copyright © 2015-2017 A-Frame authors.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

*/
